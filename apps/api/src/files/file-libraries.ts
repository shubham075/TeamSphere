import { Injectable } from '@nestjs/common';
import type { FileOwnerType, FileRole } from '@teamsphere/shared';
import { PrismaService } from '../prisma/prisma.service';
import { channelLibraryRole, personalLibraryRole } from './files.logic';

/**
 * Who owns and manages a library: a user's "My files", or a channel's document library (the channel's Files tab).
 * Channel access mirrors the channel itself: everyone who can open the channel can edit its files; team owners
 * (and private/shared channel owners) manage it. Team-wide libraries can be added here as another owner type.
 */
@Injectable()
export class FileLibraries {
  constructor(private readonly prisma: PrismaService) {}

  async roleFor(userId: string, ownerType: FileOwnerType, ownerId: string): Promise<FileRole | null> {
    if (ownerType !== 'channel') return personalLibraryRole(userId, ownerType, ownerId);
    const channel = await this.prisma.channel.findFirst({ where: { id: ownerId, deletedAt: null }, include: { team: true } });
    if (!channel || channel.team.deletedAt) return null;
    const [member, teamMember, channelMember] = await Promise.all([
      this.prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: channel.conversationId, userId } } }),
      this.prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: channel.teamId, userId } } }),
      this.prisma.channelMember.findUnique({ where: { channelId_userId: { channelId: ownerId, userId } } }),
    ]);
    return channelLibraryRole({
      inChannel: !!member,
      teamRole: teamMember?.role ?? null,
      channelRole: (channelMember?.role as 'owner' | 'member' | undefined) ?? null,
      channelType: channel.type,
      archived: !!channel.archivedAt || !!channel.team.archivedAt,
    });
  }

  /** People who see the library's recycle bin and are asked to approve access requests. */
  async managers(ownerType: FileOwnerType, ownerId: string): Promise<string[]> {
    if (ownerType === 'user') return [ownerId];
    if (ownerType !== 'channel') return [];
    const channel = await this.prisma.channel.findUnique({ where: { id: ownerId } });
    if (!channel) return [];
    const members = await this.audience(ownerType, ownerId);
    const checks = await Promise.all(members.map(async (u) => ((await this.roleFor(u, ownerType, ownerId)) === 'owner' ? u : null)));
    return checks.filter((u): u is string => !!u);
  }

  /** Everyone who can browse the library (for realtime refreshes). */
  async audience(ownerType: FileOwnerType, ownerId: string): Promise<string[]> {
    if (ownerType === 'user') return [ownerId];
    if (ownerType !== 'channel') return [];
    const channel = await this.prisma.channel.findUnique({ where: { id: ownerId }, select: { conversationId: true } });
    if (!channel) return [];
    const rows = await this.prisma.conversationMember.findMany({ where: { conversationId: channel.conversationId }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  /** Libraries whose recycle bin and access requests `userId` manages. */
  async managedBy(userId: string): Promise<{ ownerType: FileOwnerType; ownerId: string }[]> {
    const libraries: { ownerType: FileOwnerType; ownerId: string }[] = [{ ownerType: 'user', ownerId: userId }];
    const [ownedTeams, ownedChannels] = await Promise.all([
      this.prisma.teamMember.findMany({ where: { userId, role: 'owner' }, select: { teamId: true } }),
      this.prisma.channelMember.findMany({ where: { userId, role: 'owner' }, select: { channelId: true } }),
    ]);
    const channels = await this.prisma.channel.findMany({
      where: {
        deletedAt: null,
        OR: [{ teamId: { in: ownedTeams.map((t) => t.teamId) }, type: 'standard' }, { id: { in: ownedChannels.map((c) => c.channelId) } }],
      },
      select: { id: true },
    });
    for (const c of channels) libraries.push({ ownerType: 'channel', ownerId: c.id });
    return libraries;
  }

  /** Display name for locations and breadcrumbs. */
  async label(ownerType: FileOwnerType, ownerId: string): Promise<string | null> {
    if (ownerType !== 'channel') return null;
    const channel = await this.prisma.channel.findUnique({ where: { id: ownerId }, select: { name: true, team: { select: { name: true } } } });
    return channel ? `${channel.team.name} › ${channel.name}` : null;
  }
}
