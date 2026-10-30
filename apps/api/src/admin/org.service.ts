import { BadRequestException, PayloadTooLargeException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { OrgInfo, OrgSettings, orgSettingsSchema, UpdateOrgSettingsInput, WS_EVENTS } from '@teamsphere/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StorageService } from '../infra/storage';
import { sniffImage } from '../users/users.controller';
import { uploadLimitBytes } from './policies.logic';

const ORG_ID = 'org';
const CACHE_MS = 30_000;

/** Org-wide settings (single row). Read on hot paths (uploads, link previews), so cached briefly. */
@Injectable()
export class OrgService {
  private cached: { at: number; row: { settings: OrgSettings; logoKey: string | null } } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly storage: StorageService,
  ) {}

  async settings(): Promise<OrgSettings> {
    return (await this.load()).settings;
  }

  async info(): Promise<OrgInfo> {
    const { settings, logoKey } = await this.load();
    return { ...settings, logoUrl: logoKey ? `/api/org/logo?v=${logoKey.slice(logoKey.lastIndexOf('/') + 1)}` : null };
  }

  async update(actorId: string, input: UpdateOrgSettingsInput): Promise<OrgInfo> {
    const current = await this.settings();
    const settings = orgSettingsSchema.parse({ ...current, ...input });
    await this.prisma.orgSetting.upsert({
      where: { id: ORG_ID },
      create: { id: ORG_ID, settings: settings as Prisma.InputJsonValue },
      update: { settings: settings as Prisma.InputJsonValue },
    });
    const changes = Object.fromEntries(Object.entries(input).filter(([k, v]) => current[k as keyof OrgSettings] !== v));
    this.audit.log({ actorId, action: 'admin.org_settings_updated', targetType: 'org', meta: changes as Prisma.InputJsonValue });
    return this.changed();
  }

  async setLogo(actorId: string, file: { buffer: Buffer; size: number } | null): Promise<OrgInfo> {
    const previous = (await this.load()).logoKey;
    let key: string | null = null;
    if (file) {
      const type = sniffImage(file.buffer);
      if (!type) throw new BadRequestException('Use a PNG, JPEG, GIF or WebP image');
      key = `org/logo/${randomBytes(16).toString('base64url')}`;
      await this.storage.put(key, file.buffer, type, file.size);
    }
    await this.prisma.orgSetting.upsert({ where: { id: ORG_ID }, create: { id: ORG_ID, logoKey: key }, update: { logoKey: key } });
    if (previous) await this.storage.remove(previous);
    this.audit.log({ actorId, action: key ? 'admin.org_logo_set' : 'admin.org_logo_removed', targetType: 'org' });
    return this.changed();
  }

  /** Capability URL like avatars: `v` must match the current logo's random key segment. */
  async logo(v: string | undefined) {
    const { logoKey } = await this.load();
    if (!logoKey || !v || logoKey !== `org/logo/${v}`) throw new ForbiddenException();
    return this.storage.get(logoKey);
  }

  /** Rejects uploads above the org's file size limit (never above the endpoint's own hard limit). */
  async assertUploadSize(size: number, hardLimitBytes: number): Promise<void> {
    const { maxFileSizeMb } = await this.settings();
    const limit = uploadLimitBytes(maxFileSizeMb, hardLimitBytes);
    if (size > limit) throw new PayloadTooLargeException(`Files can be at most ${Math.floor(limit / 1024 / 1024)} MB`);
  }

  async assertGuestAccess(): Promise<void> {
    if (!(await this.settings()).guestAccess) throw new ForbiddenException('Guest access is turned off for this organization');
  }

  private async load() {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.row;
    const row = await this.prisma.orgSetting.findUnique({ where: { id: ORG_ID } });
    const parsed = orgSettingsSchema.safeParse(row?.settings ?? {});
    const value = { settings: parsed.success ? parsed.data : orgSettingsSchema.parse({}), logoKey: row?.logoKey ?? null };
    this.cached = { at: Date.now(), row: value };
    return value;
  }

  private async changed(): Promise<OrgInfo> {
    this.cached = null;
    const info = await this.info();
    this.realtime.toAll(WS_EVENTS.orgUpdated, { org: true });
    return info;
  }
}
