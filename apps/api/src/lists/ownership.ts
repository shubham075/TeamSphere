import { Injectable } from '@nestjs/common';
import type { CollabPerson, CollabRole } from '@teamsphere/shared';
import { canEdit, collabRole } from '../collab/collab.logic';
import { FileLibraries } from '../files/file-libraries';
import { PrismaService } from '../prisma/prisma.service';
import { avatarUrl } from '../users/users.mapper';

export type Owner = { ownerType: 'user' | 'channel'; ownerId: string };

/**
 * Shared access rules for items owned by a person (plus explicit members) or by a channel, as used by Lists and
 * Forms. Same model as plans and whiteboards: owner manages, members edit; channel items follow the channel's
 * document-library role.
 */
@Injectable()
export class Ownership {
  constructor(
    private readonly prisma: PrismaService,
    private readonly libraries: FileLibraries,
  ) {}

  async role(userId: string, owner: Owner, memberIds: string[]): Promise<CollabRole | null> {
    if (owner.ownerType === 'channel') {
      return collabRole({ userId, ...owner, memberIds: [], channelRole: await this.libraries.roleFor(userId, 'channel', owner.ownerId) });
    }
    return collabRole({ userId, ...owner, memberIds });
  }

  /** Resolves where a new item goes; channel items need edit rights in the channel. */
  async placeFor(userId: string, channelId: string | null): Promise<Owner | null> {
    if (!channelId) return { ownerType: 'user', ownerId: userId };
    return canEdit(await this.libraries.roleFor(userId, 'channel', channelId)) ? { ownerType: 'channel', ownerId: channelId } : null;
  }

  /** Everyone who can open the item (owner + members, or the channel's audience). */
  async audience(owner: Owner, memberIds: string[]): Promise<string[]> {
    if (owner.ownerType === 'channel') return this.libraries.audience('channel', owner.ownerId);
    return [owner.ownerId, ...memberIds];
  }

  async myChannelIds(userId: string): Promise<string[]> {
    const memberships = await this.prisma.conversationMember.findMany({ where: { userId }, select: { conversationId: true } });
    const channels = await this.prisma.channel.findMany({
      where: { conversationId: { in: memberships.map((m) => m.conversationId) }, deletedAt: null, team: { deletedAt: null } },
      select: { id: true },
    });
    return channels.map((c) => c.id);
  }

  async channels(ids: string[]): Promise<Map<string, { id: string; name: string; teamName: string }>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.prisma.channel.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, team: { select: { name: true } } } });
    return new Map(rows.map((c) => [c.id, { id: c.id, name: c.name, teamName: c.team.name }]));
  }

  async activeUsers(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] }, isActive: true, role: { not: 'guest' } }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  async people(ids: (string | null | undefined)[]): Promise<Map<string, CollabPerson>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true, avatarKey: true } });
    return new Map(rows.map((u) => [u.id, { id: u.id, displayName: u.displayName, avatarUrl: avatarUrl(u) }]));
  }
}
