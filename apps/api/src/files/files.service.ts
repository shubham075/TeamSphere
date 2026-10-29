import {
  BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException,
  OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { FileItem, Prisma } from '@prisma/client';
import {
  AccessRequestInfo, AccessRequestInput, ActivityItem, ChatFileInfo, CreateFolderInput, DecideAccessRequestInput,
  FILE_WS_EVENTS, FileActivityType, FileCrumb, FileDetail, FileItemInfo, FileNoAccessInfo, FileOwnerType, FilePerson,
  FileRole, FileSharingInfo, FileShareRole, FileVersionInfo, FolderListing, ShareFileInput, ShareLinkInfo,
  WS_EVENTS,
} from '@teamsphere/shared';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../infra/storage';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { FileLibraries } from './file-libraries';
import { AccessNode, can, effectiveRole, FileAction, maxRole, nextVersion, planRestore, planUpload, purgeCutoff, uniqueName } from './files.logic';

export interface UploadedContent {
  name: string;
  mimeType: string;
  size: number;
  /** Writes the bytes to object storage under `key`. */
  store: (key: string) => Promise<void>;
}

interface Access {
  item: FileItem;
  role: FileRole | null;
  /** The item first, then each folder above it. */
  chain: { id: string; name: string; parentId: string | null; node: AccessNode }[];
}

type Ctx = { ip?: string | null };

const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const NAME_CLASH = (name: string) => new ConflictException(`A file or folder named "${name}" already exists here`);

@Injectable()
export class FilesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FilesService.name);
  private purgeTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly libraries: FileLibraries,
  ) {}

  onModuleInit() {
    // Recycle bin auto-purge. Runs on every API instance; deleting already-deleted rows is harmless.
    const run = () => void this.purgeExpired().catch((e) => this.logger.error(`recycle bin purge failed: ${e}`));
    this.purgeTimer = setInterval(run, PURGE_INTERVAL_MS);
    this.purgeTimer.unref();
    setTimeout(run, 30_000).unref();
  }

  onModuleDestroy() {
    clearInterval(this.purgeTimer);
  }

  // ------------------------------------------------------------------ browsing

  async listFolder(me: string, folderId: string | null, library?: Library): Promise<FolderListing> {
    if (!folderId) {
      const lib = library ?? { ownerType: 'user', ownerId: me };
      const role = await this.libraries.roleFor(me, lib.ownerType, lib.ownerId);
      if (!can(role, 'read')) throw new NotFoundException('Library not found');
      const rows = await this.prisma.fileItem.findMany({
        where: { ownerType: lib.ownerType, ownerId: lib.ownerId, parentId: null, deletedAt: null },
        include: this.childInclude(me),
      });
      const name = (await this.libraries.label(lib.ownerType, lib.ownerId)) ?? 'My files';
      return { root: 'my', folder: null, breadcrumbs: [{ id: null, name }], role: role!, items: await this.presentChildren(me, rows, role!) };
    }
    const access = await this.require(me, folderId, 'read');
    if (access.item.kind !== 'folder') throw new BadRequestException('Not a folder');
    const rows = await this.prisma.fileItem.findMany({ where: { parentId: folderId, deletedAt: null }, include: this.childInclude(me) });
    const libraryRole = await this.libraries.roleFor(me, access.item.ownerType, access.item.ownerId);
    const [folder] = await this.present([access.item], () => access.role!);
    return {
      root: libraryRole ? 'my' : 'shared',
      folder,
      breadcrumbs: await this.breadcrumbs(me, access, libraryRole),
      role: access.role!,
      items: await this.presentChildren(me, rows, access.role!),
    };
  }

  async detail(me: string, id: string, ctx: Ctx): Promise<FileDetail> {
    const access = await this.access(me, id);
    if (!can(access.role, 'read')) {
      const pending = await this.prisma.fileAccessRequest.count({ where: { itemId: id, requesterId: me, status: 'pending' } });
      throw new ForbiddenException({ code: 'no_access', name: null, pendingRequest: pending > 0 } satisfies FileNoAccessInfo);
    }
    const { item } = access;
    const [info] = await this.present([item], () => access.role!);
    let contentUrl: string | null = null;
    let downloadUrl: string | null = null;
    if (item.kind === 'file') {
      const current = await this.prisma.fileVersion.findUnique({ where: { fileId_version: { fileId: item.id, version: item.version } } });
      if (current) ({ contentUrl, downloadUrl } = this.urls(current.id));
      await this.touchRecent(me, item.id);
      this.audit.log({ actorId: me, action: 'file.open', targetType: 'file', targetId: item.id, ip: ctx.ip });
    }
    const libraryRole = await this.libraries.roleFor(me, item.ownerType, item.ownerId);
    return { ...info, contentUrl, downloadUrl, breadcrumbs: await this.breadcrumbs(me, access, libraryRole) };
  }

  async sharedWithMe(me: string): Promise<FileItemInfo[]> {
    const [shares, uses] = await Promise.all([
      this.prisma.fileShare.findMany({ where: { userId: me, item: { deletedAt: null } }, include: { item: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.shareLinkUse.findMany({
        where: { userId: me, link: { revokedAt: null, item: { deletedAt: null } } },
        include: { link: { include: { item: true } } },
        orderBy: { firstUsed: 'desc' },
      }),
    ]);
    const entries = new Map<string, { item: FileItem; role: FileShareRole; sharedById: string | null; at: Date }>();
    for (const s of shares) entries.set(s.itemId, { item: s.item, role: s.role, sharedById: s.createdById, at: s.createdAt });
    for (const u of uses) {
      const prev = entries.get(u.link.itemId);
      if (!prev || (prev.role === 'view' && u.link.role === 'edit'))
        entries.set(u.link.itemId, { item: u.link.item, role: maxRole(prev?.role, u.link.role) as FileShareRole, sharedById: prev?.sharedById ?? u.link.createdById, at: prev?.at ?? u.firstUsed });
    }
    const list = [...entries.values()].filter((e) => !(e.item.ownerType === 'user' && e.item.ownerId === me)).sort((a, b) => +b.at - +a.at);
    const people = await this.people(list.map((e) => e.sharedById));
    const infos = await this.present(list.map((e) => e.item), (_, i) => list[i].role);
    return infos.map((info, i) => ({ ...info, sharedBy: this.person(people, list[i].sharedById), accessedAt: list[i].at.toISOString() }));
  }

  async recent(me: string): Promise<FileItemInfo[]> {
    const rows = await this.prisma.fileRecent.findMany({
      where: { userId: me, item: { deletedAt: null, kind: 'file' } },
      include: { item: true },
      orderBy: { accessedAt: 'desc' },
      take: 50,
    });
    const visible: { item: FileItem; role: FileRole; at: Date }[] = [];
    for (const r of rows) {
      const { role } = await this.access(me, r.itemId);
      if (can(role, 'read')) visible.push({ item: r.item, role: role!, at: r.accessedAt });
    }
    const infos = await this.present(visible.map((v) => v.item), (_, i) => visible[i].role);
    const locations = await this.locations(me, visible.map((v) => v.item));
    return infos.map((info, i) => ({ ...info, accessedAt: visible[i].at.toISOString(), location: locations[i] }));
  }

  /** Name search across the user's library and everything shared with them (including inside shared folders). */
  async search(me: string, q: string): Promise<FileItemInfo[]> {
    const term = q.trim();
    if (!term) return [];
    const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE roots AS (
        SELECT "itemId" AS id FROM "FileShare" WHERE "userId" = ${me}
        UNION
        SELECT l."itemId" FROM "ShareLinkUse" u JOIN "ShareLink" l ON l.id = u."linkId"
        WHERE u."userId" = ${me} AND l."revokedAt" IS NULL
      ), tree AS (
        SELECT id FROM roots
        UNION
        SELECT f.id FROM "FileItem" f JOIN tree t ON f."parentId" = t.id
      )
      SELECT id FROM "FileItem"
      WHERE "deletedAt" IS NULL AND name ILIKE ${pattern}
        AND (("ownerType" = 'user' AND "ownerId" = ${me}) OR id IN (SELECT id FROM tree)
          OR ("ownerType" = 'channel' AND "ownerId" IN (
            SELECT c.id FROM "Channel" c JOIN "ConversationMember" m ON m."conversationId" = c."conversationId"
            WHERE m."userId" = ${me} AND c."deletedAt" IS NULL)))
      ORDER BY "modifiedAt" DESC
      LIMIT 50`;
    const found: { item: FileItem; role: FileRole }[] = [];
    for (const { id } of rows) {
      const access = await this.access(me, id);
      if (can(access.role, 'read')) found.push({ item: access.item, role: access.role! });
    }
    const infos = await this.present(found.map((f) => f.item), (_, i) => found[i].role);
    const locations = await this.locations(me, found.map((f) => f.item));
    return infos.map((info, i) => ({ ...info, location: locations[i] }));
  }

  async recycleBin(me: string): Promise<FileItemInfo[]> {
    const libraries = await this.libraries.managedBy(me);
    const rows = await this.prisma.fileItem.findMany({
      where: { inRecycleBin: true, OR: libraries.map((l) => ({ ownerType: l.ownerType, ownerId: l.ownerId })) },
      orderBy: { deletedAt: 'desc' },
    });
    const people = await this.people(rows.map((r) => r.deletedById));
    const infos = await this.present(rows, () => 'owner');
    const locations = await this.locations(me, rows);
    return infos.map((info, i) => ({
      ...info,
      deletedAt: rows[i].deletedAt?.toISOString() ?? null,
      deletedBy: this.person(people, rows[i].deletedById),
      location: locations[i],
    }));
  }

  /** Attachments from the user's chats (read-only; respects "added without history"). */
  async chatFiles(me: string): Promise<ChatFileInfo[]> {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId: me },
      select: {
        historySince: true,
        conversation: { select: { id: true, title: true, type: true, members: { select: { user: { select: { id: true, displayName: true } } } } } },
      },
    });
    const since = new Map(memberships.map((m) => [m.conversation.id, m.historySince]));
    const rows = await this.prisma.attachment.findMany({
      where: { conversationId: { in: [...since.keys()] }, messageId: { not: null }, message: { deletedAt: null } },
      include: { uploader: { select: { id: true, displayName: true, avatarKey: true } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const titles = new Map(
      memberships.map(({ conversation: c }) => [
        c.id,
        c.title ??
          (c.type === 'self'
            ? 'Notes to self'
            : c.members.filter((m) => m.user.id !== me).map((m) => m.user.displayName).join(', ') || 'Chat'),
      ]),
    );
    return rows
      .filter((a) => {
        const s = since.get(a.conversationId);
        return !s || a.createdAt >= s;
      })
      .slice(0, 200)
      .map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        size: a.size,
        url: `/api/attachments/${a.id}/content?${this.storage.sign(a.id)}`,
        sharedBy: { id: a.uploader.id, displayName: a.uploader.displayName, avatarUrl: avatar(a.uploader) },
        conversationId: a.conversationId,
        conversationTitle: titles.get(a.conversationId) ?? 'Chat',
        createdAt: a.createdAt.toISOString(),
      }));
  }

  // ------------------------------------------------------------------ creating and versions

  async createFolder(me: string, input: CreateFolderInput, ctx: Ctx, library?: Library): Promise<FileItemInfo> {
    const target = await this.target(me, input.parentId, library);
    if (await this.sibling(target, input.name)) throw NAME_CLASH(input.name);
    const folder = await this.prisma.fileItem.create({
      data: { ...target.library, parentId: target.parentId, kind: 'folder', name: input.name, createdById: me, modifiedById: me },
    });
    this.audit.log({ actorId: me, action: 'file.folder.create', targetType: 'file', targetId: folder.id, ip: ctx.ip });
    await this.changed([folder.id], target.parentId);
    return (await this.present([folder], () => target.role))[0];
  }

  /** Upload into a folder. A file with the same name there gets a new version instead of a duplicate. */
  async upload(me: string, parentId: string | null, file: UploadedContent, ctx: Ctx, library?: Library): Promise<FileItemInfo & { versioned: boolean }> {
    const target = await this.target(me, parentId, library);
    const existing = await this.sibling(target, file.name);
    const plan = planUpload(existing);
    if (plan === 'conflict') throw NAME_CLASH(file.name);
    if (plan === 'new-version') return { ...(await this.addVersion(me, existing!.id, file, ctx)), versioned: true };

    const key = this.newKey(target.library);
    await file.store(key);
    try {
      const item = await this.prisma.fileItem.create({
        data: {
          ...target.library,
          parentId: target.parentId,
          kind: 'file',
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          storageKey: key,
          createdById: me,
          modifiedById: me,
          versions: { create: { version: 1, storageKey: key, size: file.size, mimeType: file.mimeType, createdById: me } },
        },
      });
      await this.touchRecent(me, item.id);
      this.audit.log({ actorId: me, action: 'file.upload', targetType: 'file', targetId: item.id, meta: { name: file.name, size: file.size }, ip: ctx.ip });
      await this.changed([item.id], target.parentId);
      return { ...(await this.present([item], () => target.role))[0], versioned: false };
    } catch (e) {
      await this.storage.remove(key);
      throw e;
    }
  }

  async addVersion(me: string, id: string, file: UploadedContent, ctx: Ctx): Promise<FileItemInfo> {
    const access = await this.require(me, id, 'write');
    if (access.item.kind !== 'file') throw new BadRequestException('Folders have no versions');
    const key = this.newKey(access.item);
    await file.store(key);
    try {
      const item = await this.prisma.$transaction(async (tx) => {
        const versions = await tx.fileVersion.findMany({ where: { fileId: id }, select: { version: true } });
        const version = nextVersion(versions);
        await tx.fileVersion.create({ data: { fileId: id, version, storageKey: key, size: file.size, mimeType: file.mimeType, createdById: me } });
        return tx.fileItem.update({
          where: { id },
          data: { version, storageKey: key, size: file.size, mimeType: file.mimeType, modifiedById: me, modifiedAt: new Date() },
        });
      });
      await this.touchRecent(me, id);
      this.audit.log({ actorId: me, action: 'file.version.upload', targetType: 'file', targetId: id, meta: { version: item.version }, ip: ctx.ip });
      await this.changed([id], item.parentId);
      return (await this.present([item], () => access.role!))[0];
    } catch (e) {
      await this.storage.remove(key);
      throw e;
    }
  }

  async versions(me: string, id: string): Promise<FileVersionInfo[]> {
    const { item } = await this.require(me, id, 'read');
    const rows = await this.prisma.fileVersion.findMany({ where: { fileId: id }, orderBy: { version: 'desc' } });
    const people = await this.people(rows.map((r) => r.createdById));
    return rows.map((v) => ({
      id: v.id,
      version: v.version,
      size: v.size,
      mimeType: v.mimeType,
      createdBy: this.person(people, v.createdById),
      createdAt: v.createdAt.toISOString(),
      current: v.version === item.version,
      downloadUrl: this.urls(v.id).downloadUrl,
    }));
  }

  async restoreVersion(me: string, id: string, versionId: string, ctx: Ctx): Promise<FileItemInfo> {
    const access = await this.require(me, id, 'write');
    const item = await this.prisma.$transaction(async (tx) => {
      const versions = await tx.fileVersion.findMany({ where: { fileId: id } });
      if (!versions.some((v) => v.id === versionId)) throw new NotFoundException('Version not found');
      const plan = planRestore(versions, versionId);
      if (!plan) return access.item;
      const source = versions.find((v) => v.id === versionId)!;
      await tx.fileVersion.create({
        data: { fileId: id, version: plan.version, storageKey: source.storageKey, size: source.size, mimeType: source.mimeType, createdById: me },
      });
      return tx.fileItem.update({
        where: { id },
        data: { version: plan.version, storageKey: source.storageKey, size: source.size, mimeType: source.mimeType, modifiedById: me, modifiedAt: new Date() },
      });
    });
    this.audit.log({ actorId: me, action: 'file.version.restore', targetType: 'file', targetId: id, meta: { versionId }, ip: ctx.ip });
    await this.changed([id], item.parentId);
    return (await this.present([item], () => access.role!))[0];
  }

  // ------------------------------------------------------------------ organizing

  async rename(me: string, id: string, name: string, ctx: Ctx): Promise<FileItemInfo> {
    const access = await this.require(me, id, 'write');
    const { item } = access;
    const clash = await this.sibling({ library: item, parentId: item.parentId }, name);
    if (clash && clash.id !== id) throw NAME_CLASH(name);
    const updated = await this.prisma.fileItem.update({ where: { id }, data: { name, modifiedById: me, modifiedAt: new Date() } });
    this.audit.log({ actorId: me, action: 'file.rename', targetType: 'file', targetId: id, meta: { from: item.name, to: name }, ip: ctx.ip });
    await this.changed([id], item.parentId);
    return (await this.present([updated], () => access.role!))[0];
  }

  /** Move within the same library (moving between libraries is a copy, as in other document libraries). */
  async move(me: string, id: string, parentId: string | null, ctx: Ctx, library?: Library): Promise<FileItemInfo> {
    const access = await this.require(me, id, 'write');
    const { item } = access;
    const target = await this.target(me, parentId, library ?? (parentId ? undefined : { ownerType: item.ownerType, ownerId: item.ownerId }));
    if (target.library.ownerType !== item.ownerType || target.library.ownerId !== item.ownerId) {
      throw new BadRequestException('Items can only be moved within the same library. Use “Copy to” instead.');
    }
    if (target.parentId === item.parentId) return (await this.present([item], () => access.role!))[0];
    if (target.parentId && (await this.descendantIds(id)).includes(target.parentId)) {
      throw new BadRequestException('A folder can’t be moved into itself');
    }
    const name = await this.freeName(target, item.name);
    const updated = await this.prisma.fileItem.update({ where: { id }, data: { parentId: target.parentId, name } });
    this.audit.log({ actorId: me, action: 'file.move', targetType: 'file', targetId: id, meta: { from: item.parentId, to: target.parentId }, ip: ctx.ip });
    await this.changed([id], item.parentId, target.parentId);
    return (await this.present([updated], () => access.role!))[0];
  }

  async copy(me: string, id: string, parentId: string | null, ctx: Ctx, library?: Library): Promise<FileItemInfo> {
    const { item } = await this.require(me, id, 'read');
    const target = await this.target(me, parentId, library);
    if (item.kind === 'folder' && target.parentId && (await this.descendantIds(id)).includes(target.parentId)) {
      throw new BadRequestException('A folder can’t be copied into itself');
    }
    const copy = await this.copyTree(me, item, target.library, target.parentId, await this.freeName(target, item.name));
    this.audit.log({ actorId: me, action: 'file.copy', targetType: 'file', targetId: copy.id, meta: { source: id }, ip: ctx.ip });
    await this.changed([copy.id], target.parentId);
    return (await this.present([copy], () => target.role))[0];
  }

  private async copyTree(me: string, source: FileItem, library: Library, parentId: string | null, name: string): Promise<FileItem> {
    if (source.kind === 'file') {
      const key = this.newKey(library);
      const object = await this.storage.get(source.storageKey!);
      await this.storage.put(key, object.body, source.mimeType ?? 'application/octet-stream', source.size);
      return this.prisma.fileItem.create({
        data: {
          ...library, parentId, kind: 'file', name, mimeType: source.mimeType, size: source.size, storageKey: key,
          createdById: me, modifiedById: me,
          versions: { create: { version: 1, storageKey: key, size: source.size, mimeType: source.mimeType ?? 'application/octet-stream', createdById: me } },
        },
      });
    }
    const folder = await this.prisma.fileItem.create({ data: { ...library, parentId, kind: 'folder', name, createdById: me, modifiedById: me } });
    const children = await this.prisma.fileItem.findMany({ where: { parentId: source.id, deletedAt: null } });
    for (const child of children) await this.copyTree(me, child, library, folder.id, child.name);
    return folder;
  }

  // ------------------------------------------------------------------ recycle bin

  async softDelete(me: string, id: string, ctx: Ctx): Promise<void> {
    const { item } = await this.require(me, id, 'write');
    const now = new Date();
    const ids = await this.descendantIds(id);
    await this.prisma.$transaction([
      // Items deleted earlier keep their own timestamp so they stay in the bin when this one is restored.
      this.prisma.fileItem.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: now, deletedById: me } }),
      this.prisma.fileItem.update({ where: { id }, data: { inRecycleBin: true } }),
    ]);
    this.audit.log({ actorId: me, action: 'file.delete', targetType: 'file', targetId: id, meta: { name: item.name }, ip: ctx.ip });
    await this.changed([id], item.parentId);
  }

  async restore(me: string, id: string, ctx: Ctx): Promise<FileItemInfo> {
    const item = await this.binItem(me, id);
    // Back to the original folder, or the library root if that folder is gone or deleted too.
    const parent = item.parentId ? await this.prisma.fileItem.findUnique({ where: { id: item.parentId } }) : null;
    const parentId = parent && !parent.deletedAt ? parent.id : null;
    const name = await this.freeName({ library: item, parentId }, item.name);
    const ids = await this.descendantIds(id);
    await this.prisma.$transaction([
      this.prisma.fileItem.updateMany({ where: { id: { in: ids }, deletedAt: item.deletedAt }, data: { deletedAt: null, deletedById: null } }),
      this.prisma.fileItem.update({ where: { id }, data: { inRecycleBin: false, parentId, name } }),
    ]);
    this.audit.log({ actorId: me, action: 'file.restore', targetType: 'file', targetId: id, ip: ctx.ip });
    await this.changed([id], parentId);
    const restored = await this.prisma.fileItem.findUniqueOrThrow({ where: { id } });
    return (await this.present([restored], () => 'owner'))[0];
  }

  async purge(me: string, id: string, ctx: Ctx): Promise<void> {
    const item = await this.binItem(me, id);
    await this.hardDelete([id]);
    this.audit.log({ actorId: me, action: 'file.purge', targetType: 'file', targetId: id, meta: { name: item.name }, ip: ctx.ip });
  }

  async emptyRecycleBin(me: string, ctx: Ctx): Promise<void> {
    const libraries = await this.libraries.managedBy(me);
    const rows = await this.prisma.fileItem.findMany({
      where: { inRecycleBin: true, OR: libraries.map((l) => ({ ownerType: l.ownerType, ownerId: l.ownerId })) },
      select: { id: true },
    });
    await this.hardDelete(rows.map((r) => r.id));
    this.audit.log({ actorId: me, action: 'file.recycle_bin.empty', meta: { count: rows.length }, ip: ctx.ip });
  }

  async purgeExpired(now = new Date()): Promise<number> {
    const rows = await this.prisma.fileItem.findMany({ where: { inRecycleBin: true, deletedAt: { lt: purgeCutoff(now) } }, select: { id: true } });
    if (rows.length) {
      await this.hardDelete(rows.map((r) => r.id));
      this.audit.log({ action: 'file.recycle_bin.purge', meta: { count: rows.length } });
      this.logger.log(`Purged ${rows.length} item(s) from recycle bins`);
    }
    return rows.length;
  }

  private async hardDelete(rootIds: string[]) {
    if (!rootIds.length) return;
    const ids = (await Promise.all(rootIds.map((id) => this.descendantIds(id)))).flat();
    const versions = await this.prisma.fileVersion.findMany({ where: { fileId: { in: ids } }, select: { storageKey: true } });
    // Children go with their parents (onDelete: Cascade); versions, shares and links likewise.
    await this.prisma.fileItem.deleteMany({ where: { id: { in: rootIds } } });
    await Promise.all([...new Set(versions.map((v) => v.storageKey))].map((k) => this.storage.remove(k)));
  }

  private async binItem(me: string, id: string) {
    const access = await this.access(me, id, true);
    if (!access.item.inRecycleBin) throw new NotFoundException('Not in the recycle bin');
    if (!can(await this.libraries.roleFor(me, access.item.ownerType, access.item.ownerId), 'purge')) throw new ForbiddenException();
    return access.item;
  }

  // ------------------------------------------------------------------ sharing

  async sharing(me: string, id: string): Promise<FileSharingInfo> {
    const access = await this.require(me, id, 'share');
    const ids = access.chain.map((c) => c.id);
    const names = new Map(access.chain.map((c) => [c.id, c.name]));
    const [shares, links, requests, managers] = await Promise.all([
      this.prisma.fileShare.findMany({ where: { itemId: { in: ids } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.shareLink.findMany({ where: { itemId: { in: ids }, revokedAt: null }, orderBy: { createdAt: 'asc' } }),
      this.prisma.fileAccessRequest.findMany({ where: { itemId: id, status: 'pending' }, orderBy: { createdAt: 'asc' } }),
      this.libraries.managers(access.item.ownerType, access.item.ownerId),
    ]);
    const people = await this.people([...shares.map((s) => s.userId), ...links.map((l) => l.createdById), ...managers]);
    const inherited = (itemId: string) => (itemId === id ? null : { id: itemId, name: names.get(itemId)! });
    // Keep the closest grant per person (the item's own share wins over a parent folder's).
    const byUser = new Map<string, (typeof shares)[number]>();
    for (const s of shares.sort((a, b) => ids.indexOf(a.itemId) - ids.indexOf(b.itemId))) if (!byUser.has(s.userId)) byUser.set(s.userId, s);
    return {
      owner: managers[0] ? this.person(people, managers[0]) : null,
      shares: [...byUser.values()]
        .filter((s) => people.has(s.userId))
        .map((s) => ({ user: this.person(people, s.userId)!, role: s.role, inheritedFrom: inherited(s.itemId), createdAt: s.createdAt.toISOString() })),
      links: links.map((l) => this.toLink(l, people, inherited(l.itemId))),
      requests: await this.presentRequests(requests, access.item),
    };
  }

  async share(me: string, id: string, input: ShareFileInput, ctx: Ctx): Promise<FileSharingInfo> {
    const { item } = await this.require(me, id, 'share');
    const managers = await this.libraries.managers(item.ownerType, item.ownerId);
    const userIds = [...new Set(input.userIds)].filter((u) => u !== me && !managers.includes(u));
    const valid = await this.prisma.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { id: true } });
    if (valid.length !== userIds.length) throw new BadRequestException('Unknown or inactive user');
    for (const userId of userIds) {
      const existing = await this.prisma.fileShare.findUnique({ where: { itemId_userId: { itemId: id, userId } } });
      await this.prisma.fileShare.upsert({
        where: { itemId_userId: { itemId: id, userId } },
        create: { itemId: id, userId, role: input.role, createdById: me },
        update: { role: input.role },
      });
      if (!existing) await this.notify(userId, 'file_shared', me, item.name + (input.message ? ` — ${input.message}` : ''));
    }
    // Sharing settles any pending requests from the same people.
    await this.prisma.fileAccessRequest.updateMany({
      where: { itemId: id, requesterId: { in: userIds }, status: 'pending' },
      data: { status: 'approved', decidedById: me, decidedAt: new Date() },
    });
    this.audit.log({ actorId: me, action: 'file.share', targetType: 'file', targetId: id, meta: { userIds, role: input.role }, ip: ctx.ip });
    await this.changed([id], item.parentId);
    return this.sharing(me, id);
  }

  async unshare(me: string, id: string, userId: string, ctx: Ctx): Promise<FileSharingInfo> {
    const { item } = await this.require(me, id, 'share');
    const { count } = await this.prisma.fileShare.deleteMany({ where: { itemId: id, userId } });
    if (count) {
      this.audit.log({ actorId: me, action: 'file.unshare', targetType: 'file', targetId: id, meta: { userId }, ip: ctx.ip });
      this.realtime.toUsers([userId], FILE_WS_EVENTS.changed, { itemIds: [id] });
      await this.changed([id], item.parentId);
    }
    return this.sharing(me, id);
  }

  /** One active org-wide link per role, like other document libraries. */
  async createLink(me: string, id: string, role: FileShareRole, ctx: Ctx): Promise<ShareLinkInfo> {
    const { item } = await this.require(me, id, 'share');
    let link = await this.prisma.shareLink.findFirst({ where: { itemId: id, role, revokedAt: null } });
    if (!link) {
      link = await this.prisma.shareLink.create({ data: { itemId: id, role, token: randomBytes(18).toString('base64url'), createdById: me } });
      this.audit.log({ actorId: me, action: 'file.link.create', targetType: 'file', targetId: id, meta: { role }, ip: ctx.ip });
      await this.changed([id], item.parentId);
    }
    return this.toLink(link, await this.people([link.createdById]), null);
  }

  async revokeLink(me: string, linkId: string, ctx: Ctx): Promise<void> {
    const link = await this.prisma.shareLink.findUnique({ where: { id: linkId }, include: { uses: { select: { userId: true } } } });
    if (!link || link.revokedAt) throw new NotFoundException();
    const { item } = await this.require(me, link.itemId, 'share');
    await this.prisma.shareLink.update({ where: { id: linkId }, data: { revokedAt: new Date() } });
    this.audit.log({ actorId: me, action: 'file.link.revoke', targetType: 'file', targetId: link.itemId, meta: { linkId }, ip: ctx.ip });
    this.realtime.toUsers(link.uses.map((u) => u.userId), FILE_WS_EVENTS.changed, { itemIds: [link.itemId] });
    await this.changed([link.itemId], item.parentId);
  }

  /** Opening an org link: remembers the user so the item shows under "Shared with me" while the link lives. */
  async redeemLink(me: string, token: string, ctx: Ctx): Promise<{ id: string; kind: 'file' | 'folder' }> {
    const link = await this.prisma.shareLink.findUnique({ where: { token }, include: { item: true } });
    if (!link) throw new NotFoundException('This link doesn’t exist');
    if (link.revokedAt) throw new GoneException('This link has been removed by the owner');
    if (link.item.deletedAt) throw new NotFoundException('This item has been deleted');
    await this.prisma.shareLinkUse.upsert({ where: { linkId_userId: { linkId: link.id, userId: me } }, create: { linkId: link.id, userId: me }, update: {} });
    this.audit.log({ actorId: me, action: 'file.link.open', targetType: 'file', targetId: link.itemId, meta: { linkId: link.id }, ip: ctx.ip });
    return { id: link.itemId, kind: link.item.kind };
  }

  // ------------------------------------------------------------------ access requests

  async requestAccess(me: string, id: string, input: AccessRequestInput, ctx: Ctx): Promise<void> {
    const access = await this.access(me, id);
    if (access.role === 'owner' || access.role === 'edit' || (access.role === 'view' && input.role === 'view')) {
      throw new BadRequestException('You already have access');
    }
    const pending = await this.prisma.fileAccessRequest.findFirst({ where: { itemId: id, requesterId: me, status: 'pending' } });
    const request = pending
      ? await this.prisma.fileAccessRequest.update({ where: { id: pending.id }, data: { role: input.role, message: input.message ?? null } })
      : await this.prisma.fileAccessRequest.create({ data: { itemId: id, requesterId: me, role: input.role, message: input.message ?? null } });
    this.audit.log({ actorId: me, action: 'file.access.request', targetType: 'file', targetId: id, meta: { role: input.role }, ip: ctx.ip });
    if (pending) return;
    const managers = await this.libraries.managers(access.item.ownerType, access.item.ownerId);
    const [info] = await this.presentRequests([request], access.item);
    for (const m of managers) await this.notify(m, 'file_access_request', me, access.item.name + (input.message ? ` — ${input.message}` : ''));
    this.realtime.toUsers(managers, FILE_WS_EVENTS.accessRequest, info);
  }

  async incomingRequests(me: string): Promise<AccessRequestInfo[]> {
    const libraries = await this.libraries.managedBy(me);
    const rows = await this.prisma.fileAccessRequest.findMany({
      where: { status: 'pending', item: { deletedAt: null, OR: libraries.map((l) => ({ ownerType: l.ownerType, ownerId: l.ownerId })) } },
      include: { item: true },
      orderBy: { createdAt: 'desc' },
    });
    return (await Promise.all(rows.map((r) => this.presentRequests([r], r.item)))).flat();
  }

  async decideRequest(me: string, requestId: string, input: DecideAccessRequestInput, ctx: Ctx): Promise<void> {
    const request = await this.prisma.fileAccessRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== 'pending') throw new NotFoundException('This request was already handled');
    const { item } = await this.require(me, request.itemId, 'share');
    const approve = input.decision === 'approve';
    const role = input.role ?? request.role;
    await this.prisma.$transaction(async (tx) => {
      await tx.fileAccessRequest.update({ where: { id: requestId }, data: { status: approve ? 'approved' : 'denied', decidedById: me, decidedAt: new Date() } });
      if (approve) {
        const existing = await tx.fileShare.findUnique({ where: { itemId_userId: { itemId: item.id, userId: request.requesterId } } });
        await tx.fileShare.upsert({
          where: { itemId_userId: { itemId: item.id, userId: request.requesterId } },
          create: { itemId: item.id, userId: request.requesterId, role, createdById: me },
          update: { role: maxRole(existing?.role, role) as FileShareRole },
        });
      }
    });
    this.audit.log({ actorId: me, action: approve ? 'file.access.approve' : 'file.access.deny', targetType: 'file', targetId: item.id, meta: { requestId, role }, ip: ctx.ip });
    await this.notify(request.requesterId, approve ? 'file_access_approved' : 'file_access_denied', me, item.name);
    this.realtime.toUsers([request.requesterId], FILE_WS_EVENTS.changed, { itemIds: [item.id] });
    await this.changed([item.id], item.parentId);
  }

  /** Version lookup for the signed content route. */
  version(versionId: string) {
    return this.prisma.fileVersion.findUnique({ where: { id: versionId }, include: { file: { select: { name: true, deletedAt: true } } } });
  }

  // ------------------------------------------------------------------ permissions

  /** Loads an item with the caller's role. Deleted items are hidden unless `includeDeleted`. */
  async access(me: string, id: string, includeDeleted = false): Promise<Access> {
    const item = await this.prisma.fileItem.findUnique({ where: { id } });
    if (!item || (item.deletedAt && !includeDeleted)) throw new NotFoundException('File not found');
    const path = await this.prisma.$queryRaw<{ id: string; depth: number }[]>`
      WITH RECURSIVE chain AS (
        SELECT id, "parentId", 0 AS depth FROM "FileItem" WHERE id = ${id}
        UNION ALL
        SELECT f.id, f."parentId", c.depth + 1 FROM "FileItem" f JOIN chain c ON f.id = c."parentId"
      )
      SELECT id, depth FROM chain ORDER BY depth`;
    const rows = await this.prisma.fileItem.findMany({
      where: { id: { in: path.map((p) => p.id) } },
      select: {
        id: true,
        name: true,
        parentId: true,
        shares: { select: { userId: true, role: true } },
        links: { select: { role: true, revokedAt: true, uses: { where: { userId: me }, select: { userId: true } } } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const chain = path
      .map((p) => byId.get(p.id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({
        id: r.id,
        name: r.name,
        parentId: r.parentId,
        node: { id: r.id, shares: r.shares, links: r.links.map((l) => ({ role: l.role, revokedAt: l.revokedAt, usedBy: l.uses.map((u) => u.userId) })) },
      }));
    const libraryRole = await this.libraries.roleFor(me, item.ownerType, item.ownerId);
    return { item, chain, role: effectiveRole({ userId: me, libraryRole, chain: chain.map((c) => c.node) }) };
  }

  private async require(me: string, id: string, action: FileAction): Promise<Access> {
    const access = await this.access(me, id);
    if (!can(access.role, 'read')) throw new NotFoundException('File not found');
    if (!can(access.role, action)) {
      throw new ForbiddenException(action === 'write' ? 'You have view-only access' : 'You don’t have permission to do that');
    }
    return access;
  }

  /** Destination folder for new items: a folder the caller can edit, or the root of their own library. */
  private async target(me: string, parentId: string | null, library?: Library): Promise<{ library: Library; parentId: string | null; role: FileRole }> {
    if (!parentId) {
      const lib = library ?? { ownerType: 'user', ownerId: me };
      const role = await this.libraries.roleFor(me, lib.ownerType, lib.ownerId);
      if (!can(role, 'write')) throw new ForbiddenException('You can’t add files here');
      return { library: lib, parentId: null, role: role! };
    }
    const access = await this.require(me, parentId, 'write');
    if (access.item.kind !== 'folder') throw new BadRequestException('Not a folder');
    return { library: { ownerType: access.item.ownerType, ownerId: access.item.ownerId }, parentId, role: access.role! };
  }

  // ------------------------------------------------------------------ helpers

  private sibling(target: { library: Library; parentId: string | null }, name: string) {
    return this.prisma.fileItem.findFirst({
      where: { ownerType: target.library.ownerType, ownerId: target.library.ownerId, parentId: target.parentId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
    });
  }

  private async freeName(target: { library: Library; parentId: string | null }, name: string) {
    const siblings = await this.prisma.fileItem.findMany({
      where: { ownerType: target.library.ownerType, ownerId: target.library.ownerId, parentId: target.parentId, deletedAt: null },
      select: { name: true },
    });
    return uniqueName(name, siblings.map((s) => s.name));
  }

  private async descendantIds(id: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE tree AS (
        SELECT id FROM "FileItem" WHERE id = ${id}
        UNION ALL
        SELECT f.id FROM "FileItem" f JOIN tree t ON f."parentId" = t.id
      )
      SELECT id FROM tree`;
    return rows.map((r) => r.id);
  }

  private newKey(library: Library) {
    return `files/${library.ownerType}/${library.ownerId}/${Date.now()}-${randomBytes(6).toString('hex')}`;
  }

  private urls(versionId: string) {
    const base = `/api/files/content/${versionId}?${this.storage.sign(`fv:${versionId}`)}`;
    return { contentUrl: base, downloadUrl: `${base}&download=1` };
  }

  private async touchRecent(me: string, itemId: string) {
    await this.prisma.fileRecent.upsert({
      where: { userId_itemId: { userId: me, itemId } },
      create: { userId: me, itemId },
      update: { accessedAt: new Date() },
    });
  }

  /** Tells everyone who can see these items (and the folders they are in) to refresh. */
  private async changed(itemIds: string[], ...parentIds: (string | null)[]) {
    const audience = new Set<string>();
    for (const id of [...itemIds, ...parentIds].filter((x): x is string => !!x)) {
      const item = await this.prisma.fileItem.findUnique({ where: { id }, select: { ownerType: true, ownerId: true } });
      if (!item) continue;
      for (const m of await this.libraries.audience(item.ownerType, item.ownerId)) audience.add(m);
      const chain = await this.prisma.$queryRaw<{ id: string }[]>`
        WITH RECURSIVE chain AS (
          SELECT id, "parentId" FROM "FileItem" WHERE id = ${id}
          UNION ALL
          SELECT f.id, f."parentId" FROM "FileItem" f JOIN chain c ON f.id = c."parentId"
        )
        SELECT id FROM chain`;
      const ids = chain.map((c) => c.id);
      const [shares, uses] = await Promise.all([
        this.prisma.fileShare.findMany({ where: { itemId: { in: ids } }, select: { userId: true } }),
        this.prisma.shareLinkUse.findMany({ where: { link: { itemId: { in: ids }, revokedAt: null } }, select: { userId: true } }),
      ]);
      for (const r of [...shares, ...uses]) audience.add(r.userId);
    }
    this.realtime.toUsers(audience, FILE_WS_EVENTS.changed, { itemIds });
  }

  private async notify(userId: string, type: FileActivityType, actorId: string, preview: string) {
    const row = await this.prisma.notification.create({
      data: { userId, type, actorId, preview: preview.slice(0, 200) },
      include: { actor: { select: { id: true, displayName: true, avatarKey: true } } },
    });
    const item: ActivityItem = {
      id: row.id,
      type,
      actor: row.actor ? { id: row.actor.id, displayName: row.actor.displayName, avatarUrl: avatar(row.actor) } : null,
      conversationId: null,
      conversationTitle: null,
      messageId: null,
      preview: row.preview,
      read: false,
      createdAt: row.createdAt.toISOString(),
    };
    this.realtime.toUsers([userId], WS_EVENTS.notificationNew, item);
  }

  private childInclude(me: string) {
    return {
      shares: { select: { userId: true, role: true } },
      links: { where: { revokedAt: null }, select: { role: true, revokedAt: true, uses: { where: { userId: me }, select: { userId: true } } } },
    } satisfies Prisma.FileItemInclude;
  }

  /** Children of a folder: the folder's role, raised by any grants set directly on the child. */
  private presentChildren(me: string, rows: Prisma.FileItemGetPayload<{ include: ReturnType<FilesService['childInclude']> }>[], folderRole: FileRole) {
    const sorted = [...rows].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === 'folder' ? -1 : 1));
    return this.present(sorted, (row) => {
      const r = row as (typeof rows)[number];
      return effectiveRole({
        userId: me,
        libraryRole: folderRole,
        chain: [{ id: r.id, shares: r.shares, links: r.links.map((l) => ({ role: l.role, revokedAt: l.revokedAt, usedBy: l.uses.map((u) => u.userId) })) }],
      })!;
    }, new Map(rows.map((r) => [r.id, r.shares.length > 0 || r.links.length > 0])));
  }

  private async present(items: FileItem[], roleOf: (item: FileItem, index: number) => FileRole, sharedHint?: Map<string, boolean>): Promise<FileItemInfo[]> {
    const people = await this.people(items.flatMap((i) => [i.createdById, i.modifiedById]));
    let shared = sharedHint;
    if (!shared) {
      const ids = items.map((i) => i.id);
      const [s, l] = await Promise.all([
        this.prisma.fileShare.findMany({ where: { itemId: { in: ids } }, select: { itemId: true } }),
        this.prisma.shareLink.findMany({ where: { itemId: { in: ids }, revokedAt: null }, select: { itemId: true } }),
      ]);
      shared = new Map([...s, ...l].map((x) => [x.itemId, true]));
    }
    return items.map((i, index) => ({
      id: i.id,
      kind: i.kind,
      name: i.name,
      mimeType: i.mimeType,
      size: i.size,
      version: i.version,
      parentId: i.parentId,
      ownerType: i.ownerType,
      ownerId: i.ownerId,
      role: roleOf(i, index),
      shared: !!shared!.get(i.id),
      createdBy: this.person(people, i.createdById),
      modifiedBy: this.person(people, i.modifiedById),
      createdAt: i.createdAt.toISOString(),
      modifiedAt: i.modifiedAt.toISOString(),
    }));
  }

  /** Path from the top-most folder the caller can open down to the item's parent (plus the item if a folder). */
  private async breadcrumbs(me: string, access: Access, libraryRole: FileRole | null): Promise<FileCrumb[]> {
    const top = [...access.chain].reverse(); // root folder first
    const label = await this.libraries.label(access.item.ownerType, access.item.ownerId);
    const crumbs: FileCrumb[] = [{ id: null, name: libraryRole ? (label ?? 'My files') : 'Shared with me' }];
    let reachable = libraryRole !== null;
    const grants: AccessNode[] = [];
    for (const c of top) {
      grants.push(c.node);
      if (!reachable) reachable = effectiveRole({ userId: me, libraryRole, chain: grants }) !== null;
      if (reachable && (c.id !== access.item.id || access.item.kind === 'folder')) crumbs.push({ id: c.id, name: c.name });
    }
    return crumbs;
  }

  /** "My files / Reports"-style location of each item's parent folder. */
  private async locations(me: string, items: FileItem[]): Promise<string[]> {
    const parentIds = [...new Set(items.map((i) => i.parentId).filter((x): x is string => !!x))];
    const parents = await this.prisma.fileItem.findMany({ where: { id: { in: parentIds } }, select: { id: true, name: true } });
    const names = new Map(parents.map((p) => [p.id, p.name]));
    const owners = await this.people(items.filter((i) => i.ownerType === 'user' && i.ownerId !== me).map((i) => i.ownerId));
    const labels = new Map<string, string | null>();
    for (const i of items) if (i.ownerType !== 'user' && !labels.has(i.ownerId)) labels.set(i.ownerId, await this.libraries.label(i.ownerType, i.ownerId));
    return items.map((i) => {
      const root =
        i.ownerType !== 'user'
          ? (labels.get(i.ownerId) ?? 'Library')
          : i.ownerId === me
            ? 'My files'
            : `${owners.get(i.ownerId)?.displayName ?? 'Someone'}’s files`;
      return i.parentId ? `${root} / ${names.get(i.parentId) ?? '…'}` : root;
    });
  }

  private async presentRequests(rows: { id: string; requesterId: string; role: FileShareRole; message: string | null; status: AccessRequestInfo['status']; createdAt: Date }[], item: FileItem): Promise<AccessRequestInfo[]> {
    const people = await this.people(rows.map((r) => r.requesterId));
    return rows
      .filter((r) => people.has(r.requesterId))
      .map((r) => ({
        id: r.id,
        item: { id: item.id, name: item.name, kind: item.kind },
        requester: this.person(people, r.requesterId)!,
        role: r.role,
        message: r.message,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      }));
  }

  private toLink(l: { id: string; token: string; role: FileShareRole; createdById: string | null; createdAt: Date }, people: Map<string, FilePerson>, inheritedFrom: ShareLinkInfo['inheritedFrom']): ShareLinkInfo {
    return { id: l.id, token: l.token, role: l.role, createdBy: this.person(people, l.createdById), createdAt: l.createdAt.toISOString(), inheritedFrom };
  }

  private async people(ids: (string | null | undefined)[]): Promise<Map<string, FilePerson>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true, avatarKey: true } });
    return new Map(rows.map((u) => [u.id, { id: u.id, displayName: u.displayName, avatarUrl: avatar(u) }]));
  }

  private person(people: Map<string, FilePerson>, id: string | null | undefined): FilePerson | null {
    return (id && people.get(id)) || null;
  }
}

export type Library = { ownerType: FileOwnerType; ownerId: string };

const avatar = (u: { id: string; avatarKey: string | null }) => (u.avatarKey ? `/api/users/${u.id}/avatar` : null);
