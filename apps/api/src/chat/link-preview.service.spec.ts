import { describe, expect, it } from 'vitest';
import { firstUrl, isPrivateAddress, parsePreview } from './link-preview.service';

describe('isPrivateAddress', () => {
  it('blocks loopback, private, link-local and metadata addresses', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.20', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const a of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) expect(isPrivateAddress(a), a).toBe(false);
  });

  it('treats non-IPs as blocked', () => {
    expect(isPrivateAddress('example.com')).toBe(true);
  });
});

describe('firstUrl', () => {
  it('finds the first link and trims trailing punctuation', () => {
    expect(firstUrl('See https://example.com/a?b=1. And http://other.org')).toBe('https://example.com/a?b=1');
  });

  it('ignores links inside code', () => {
    expect(firstUrl('run `curl https://internal/x` then ```https://a.b``` ok')).toBeNull();
  });

  it('returns null without a link', () => {
    expect(firstUrl('no links here @[Alex](abcdefgh12)')).toBeNull();
  });
});

describe('parsePreview', () => {
  it('prefers Open Graph tags and resolves relative images', () => {
    const html = `<html><head><title>Fallback</title>
      <meta property="og:title" content="Release notes &amp; more">
      <meta property="og:description" content='What&#39;s new'>
      <meta property="og:image" content="/img/cover.png">
      <meta property="og:site_name" content="Example"></head><body></body></html>`;
    expect(parsePreview(html, 'https://example.com/blog/post')).toEqual({
      url: 'https://example.com/blog/post',
      title: 'Release notes & more',
      description: "What's new",
      imageUrl: 'https://example.com/img/cover.png',
      siteName: 'Example',
    });
  });

  it('falls back to <title> and the host name', () => {
    expect(parsePreview('<title> Plain page </title>', 'https://plain.example/')).toMatchObject({
      title: 'Plain page',
      description: null,
      imageUrl: null,
      siteName: 'plain.example',
    });
  });

  it('drops non-http image URLs and pages without a title', () => {
    expect(parsePreview('<meta property="og:title" content="T"><meta property="og:image" content="javascript:alert(1)">', 'https://x.y/')?.imageUrl).toBeNull();
    expect(parsePreview('<p>nothing</p>', 'https://x.y/')).toBeNull();
  });
});
