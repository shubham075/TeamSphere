import { Inject, Injectable, Logger } from '@nestjs/common';
import { lookup as dnsLookup, LookupAddress } from 'node:dns';
import http, { IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { LinkPreview } from '@teamsphere/shared';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

const URL_PATTERN = /https?:\/\/[^\s<>()[\]"'`]+/i;
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_SIZE = 500;

/** Loopback, private, link-local, CGNAT, multicast and other non-public ranges (IPv4 and IPv6). */
const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) PRIVATE.addSubnet(net, prefix, 'ipv4');
// IPv4-mapped IPv6 (::ffff:a.b.c.d) is unwrapped in isPrivateAddress; listing ::ffff:0:0/96 here would make
// BlockList match every IPv4 address.
for (const [net, prefix] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return true;
  if (family === 6 && address.toLowerCase().startsWith('::ffff:')) {
    const v4 = address.slice(7);
    if (isIP(v4) === 4) return PRIVATE.check(v4, 'ipv4');
  }
  return PRIVATE.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** First http(s) link in a message body, with trailing punctuation trimmed. */
export function firstUrl(body: string): string | null {
  const match = URL_PATTERN.exec(body.replace(/```[\s\S]*?```|`[^`\n]*`/g, ' '));
  if (!match) return null;
  const url = match[0].replace(/[.,;:!?*_~]+$/, '');
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s: string) {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pulls Open Graph / Twitter / plain HTML metadata out of a page head. */
export function parsePreview(html: string, pageUrl: string): LinkPreview | null {
  const head = html.slice(0, MAX_BYTES);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (key && content && !meta.has(key)) meta.set(key, decode(content[1] ?? content[2] ?? ''));
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const title = meta.get('og:title') || meta.get('twitter:title') || (titleTag ? decode(titleTag) : '');
  if (!title) return null;
  let imageUrl: string | null = meta.get('og:image') || meta.get('og:image:url') || meta.get('twitter:image') || null;
  if (imageUrl) {
    try {
      const resolved = new URL(imageUrl, pageUrl);
      imageUrl = resolved.protocol === 'https:' || resolved.protocol === 'http:' ? resolved.toString() : null;
    } catch {
      imageUrl = null;
    }
  }
  const description = meta.get('og:description') || meta.get('twitter:description') || meta.get('description') || null;
  return {
    url: pageUrl,
    title: title.slice(0, 200),
    description: description ? description.slice(0, 300) : null,
    imageUrl,
    siteName: (meta.get('og:site_name') || new URL(pageUrl).hostname).slice(0, 100),
  };
}

/**
 * Unfurls links in chat messages. Fetches happen server-side so recipients don't leak their IPs to the linked site.
 * Unless LINK_PREVIEW_ALLOW_PRIVATE is set, addresses are checked inside the socket's DNS lookup, so a hostname
 * can't resolve to an internal service (no SSRF, including via redirects or DNS rebinding).
 */
@Injectable()
export class LinkPreviewService {
  private readonly logger = new Logger(LinkPreviewService.name);
  private readonly cache = new Map<string, { at: number; preview: LinkPreview | null }>();

  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled() {
    return this.env.LINK_PREVIEWS_ENABLED;
  }

  async preview(url: string): Promise<LinkPreview | null> {
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.preview;
    let preview: LinkPreview | null = null;
    try {
      preview = await this.fetchPreview(url);
    } catch (e) {
      this.logger.debug(`No preview for ${url}: ${e instanceof Error ? e.message : e}`);
    }
    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(url, { at: Date.now(), preview });
    return preview;
  }

  private async fetchPreview(start: string): Promise<LinkPreview | null> {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await this.get(url);
      const location = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
        res.resume();
        url = new URL(location, url).toString();
        continue;
      }
      if (res.statusCode !== 200 || !/text\/html|application\/xhtml/i.test(String(res.headers['content-type'] ?? ''))) {
        res.resume();
        return null;
      }
      return parsePreview(await readLimited(res), url);
    }
    return null;
  }

  private get(target: string): Promise<IncomingMessage> {
    const parsed = new URL(target);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Unsupported protocol');
    if (parsed.username || parsed.password) throw new Error('Credentials in URL');
    const allowPrivate = this.env.LINK_PREVIEW_ALLOW_PRIVATE;
    const lookup = (hostname: string, options: object, callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void) => {
      dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err, '');
        const list = addresses as LookupAddress[];
        if (!allowPrivate && (!list.length || list.some((a) => isPrivateAddress(a.address)))) {
          return callback(new Error(`Blocked address for ${hostname}`), '');
        }
        if ((options as { all?: boolean }).all) return callback(null, list);
        callback(null, list[0].address, list[0].family);
      });
    };
    if (!allowPrivate && isIP(parsed.hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(parsed.hostname.replace(/^\[|\]$/g, ''))) {
      throw new Error('Blocked address');
    }
    const client = parsed.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = client.get(
        parsed,
        {
          lookup,
          timeout: TIMEOUT_MS,
          headers: {
            'User-Agent': 'TeamSphereLinkPreview/1.0 (+chat link unfurling)',
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Encoding': 'identity',
          },
        },
        resolve,
      );
      req.on('timeout', () => req.destroy(new Error('Timed out')));
      req.on('error', reject);
    });
  }
}

function readLimited(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      chunks.push(chunk);
      // The <head> is all we need; stop once we have it or hit the cap.
      if (size >= MAX_BYTES || /<\/head>/i.test(chunk.toString('latin1'))) res.destroy();
    });
    res.on('close', () => resolve(Buffer.concat(chunks).subarray(0, MAX_BYTES).toString('utf8')));
    res.on('error', reject);
  });
}
