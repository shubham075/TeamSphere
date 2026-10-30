import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Channel, Prisma, Team, TeamRole } from '@prisma/client';
import {
  ActivityItem, ChannelInfo, ChannelMemberInfo, ChannelUpdatedEvent, CreateChannelInput, CreateTeamInput,
  DELETED_RETENTION_DAYS, DiscoverTeam, MAX_CHANNELS_PER_TEAM, parseModeration, parseTeamSettings, RecycledChannel,
  TagInfo, TeamInfo, TeamMemberInfo, TeamUpdatedEvent, UpdateChannelInput, UpdateTeamInput, UserRole, WS_EVENTS,
} from '@teamsphere/shared';
import { AuditService } from '../audit/audit.service';
import { avatarUrl, toUserSummary } from '../chat/chat.mapper';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { canCreateChannel, canManageTags, channelPermissions, generateJoinCode, wouldLeaveNoOwner } from './teams.policy';

const USER_SELECT = { id: true, displayName: true, avatarKey: true, jobTitle: true } as const;
const DAY = 86_400_000;

type Actor = { id: string; role: UserRole };

/** Everything needed to decide what one person may do in one channel. */
export interface ChannelAccess {
  channel: Channel;
  team: Team;
  teamRole: TeamRole | null;
  channelRole: 'owner' | 'member' | null;
  settings: ReturnType<typeof parseTeamSettings>;
  moderation: ReturnType<typeof parseModeration>;
  permissions: ChannelInfo['permissions'];
}

@Injectable()
export class TeamsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TeamsService.name);
  private purgeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    // Deleted teams/channels are kept for the retention period, then removed with their posts.
    this.purgeTimer = setInterval(() => void this.purgeDeleted().catch((e) => this.logger.error(`purge failed: ${e}`)), 60 * 60 * 1000);
    this.purgeTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
  }

  // ------------------------------------------------------------------ teams list

  /** My teams with the channels I can see, plus host teams of shared channels I was added to directly. */
  async list(me: string): Promise<TeamInfo[]> {
    await this.ensureOrgWideMemberships(me);
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId: me, team: { deletedAt: null } },
      include: { team: true },
    });
    const myTeams = new Map(memberships.map((m) => [m.teamId, m]));

    const convMembers = await this.prisma.conversationMember.findMany({
      where: { userId: me, conversation: { type: 'channel' } },
    });
    const prefs = new Map(convMembers.map((c) => [c.conversationId, c]));
    const channels = await this.prisma.channel.findMany({
      where: { conversationId: { in: [...prefs.keys()] }, deletedAt: null, team: { deletedAt: null } },
      include: { team: true, shares: true, members: { where: { userId: me } } },
      orderBy: [{ isGeneral: 'desc' }, { name: 'asc' }],
    });

    const [unread, lastAt] = await Promise.all([this.unreadCounts(me, channels.map((c) => c.conversationId)), this.lastMessageAt(channels)]);

    // Where each channel shows up: its host team if I'm in it, else a team it's shared with that I'm in, else the host as "channel only".
    const teams = new Map<string, { team: Team; role: TeamRole | null; hidden: boolean; position: number; channels: ChannelInfo[] }>();
    for (const m of memberships) teams.set(m.teamId, { team: m.team, role: m.role, hidden: m.hidden, position: m.position, channels: [] });
    for (const c of channels) {
      const hostMember = myTeams.get(c.teamId);
      const viaShare = !hostMember ? c.shares.find((s) => myTeams.has(s.teamId)) : undefined;
      const displayTeamId = hostMember ? c.teamId : (viaShare?.teamId ?? c.teamId);
      if (!teams.has(displayTeamId)) teams.set(displayTeamId, { team: c.team, role: null, hidden: false, position: 9999, channels: [] });
      const pref = prefs.get(c.conversationId)!;
      teams.get(displayTeamId)!.channels.push(
        this.toChannelInfo(c, c.team, hostMember?.role ?? null, (c.members[0]?.role as 'owner' | 'member') ?? null, {
          me,
          unread: unread.get(c.conversationId),
          pinned: pref.pinned,
          muted: pref.muted,
          lastMessageAt: lastAt.get(c.conversationId) ?? c.createdAt,
          sharedFrom: displayTeamId !== c.teamId ? { teamId: c.teamId, teamName: c.team.name } : null,
        }),
      );
    }

    const counts = await this.prisma.teamMember.groupBy({ by: ['teamId'], where: { teamId: { in: [...teams.keys()] } }, _count: true });
    const countOf = new Map(counts.map((c) => [c.teamId, c._count]));
    return [...teams.values()]
      .map((t) => this.toTeamInfo(t.team, t.role, countOf.get(t.team.id) ?? 0, t.hidden, t.position, t.channels))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }

  async get(me: string, teamId: string): Promise<TeamInfo> {
    const team = (await this.list(me)).find((t) => t.id === teamId);
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }

  // ------------------------------------------------------------------ team lifecycle

  async create(actor: Actor, input: CreateTeamInput & { visibility: TeamInfo['visibility'] }): Promise<TeamInfo> {
    const me = actor.id;
    if (input.visibility === 'orgwide' && actor.role !== 'admin') throw new ForbiddenException('Only admins can create org-wide teams');

    let source: Prisma.TeamGetPayload<{ include: { members: true; channels: { include: { members: true } }; tags: { include: { members: true } } } }> | null = null;
    if (input.copyFrom) {
      source = await this.prisma.team.findFirst({
        where: { id: input.copyFrom.teamId, deletedAt: null, members: { some: { userId: me } } },
        include: { members: true, channels: { where: { deletedAt: null, archivedAt: null }, include: { members: true } }, tags: { include: { members: true } } },
      });
      if (!source) throw new NotFoundException('The team to copy was not found');
    }

    const settings = input.copyFrom?.settings && source ? parseTeamSettings(source.settings) : parseTeamSettings({});
    const team = await this.prisma.team.create({
      data: {
        name: input.name,
        description: input.description || null,
        visibility: input.visibility,
        settings,
        createdById: me,
        members: { create: { userId: me, role: 'owner' } },
      },
    });
    await this.createChannelRow(team, me, { name: 'General', type: 'standard', isGeneral: true });

    const roles = new Map<string, TeamRole>();
    if (source && input.copyFrom?.members) for (const m of source.members) if (m.userId !== me) roles.set(m.userId, m.role);
    for (const id of input.memberIds ?? []) if (id !== me && !roles.has(id)) roles.set(id, 'member');
    if (input.visibility === 'orgwide') {
      const everyone = await this.prisma.user.findMany({ where: { isActive: true, guestMeetingId: null, id: { not: me } }, select: { id: true } });
      for (const u of everyone) if (!roles.has(u.id)) roles.set(u.id, 'member');
    }
    if (roles.size) {
      const active = await this.activeUserIds([...roles.keys()]);
      await this.prisma.teamMember.createMany({ data: active.map((userId) => ({ teamId: team.id, userId, role: roles.get(userId)! })) });
    }

    if (source && input.copyFrom?.channels) {
      for (const c of source.channels.filter((c) => !c.isGeneral && c.type !== 'shared')) {
        const copy = await this.createChannelRow(team, me, { name: c.name, description: c.description, type: c.type, moderation: c.moderation as Prisma.InputJsonValue });
        if (c.type === 'private') {
          // The copier owns each copied private channel; its members come along only when members are copied too.
          const keep = c.members.filter((m) => m.userId !== me && input.copyFrom?.members && roles.has(m.userId));
          await this.prisma.channelMember.createMany({
            data: [{ channelId: copy.id, userId: me, role: 'owner' }, ...keep.map((m) => ({ channelId: copy.id, userId: m.userId, role: m.role }))],
          });
        }
      }
    }
    if (source && input.copyFrom?.tags) {
      const memberSet = new Set([me, ...roles.keys()]);
      for (const t of source.tags) {
        await this.prisma.tag.create({
          data: { teamId: team.id, name: t.name, members: { create: t.members.filter((m) => memberSet.has(m.userId)).map((m) => ({ userId: m.userId })) } },
        });
      }
    }

    await this.syncTeamChannels(team.id);
    await this.notifyTeamAdd(team.id, me, [...roles.keys()]);
    this.audit.log({ actorId: me, action: 'team.created', targetType: 'team', targetId: team.id, meta: { visibility: team.visibility, copiedFrom: source?.id ?? null } });
    await this.emitTeam(team.id);
    return this.get(me, team.id);
  }

  async update(me: string, teamId: string, input: UpdateTeamInput): Promise<TeamInfo> {
    const { team } = await this.requireTeamRole(me, teamId, ['owner']);
    if (input.visibility && team.visibility === 'orgwide') throw new BadRequestException('Org-wide teams can’t change visibility');
    const settings = input.settings ? { ...parseTeamSettings(team.settings), ...input.settings } : undefined;
    const updated = await this.prisma.team.update({
      where: { id: teamId },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.visibility ? { visibility: input.visibility } : {}),
        ...(settings ? { settings } : {}),
      },
    });
    if (input.name && input.name !== team.name) await this.retitleConversations(updated);
    this.audit.log({ actorId: me, action: 'team.updated', targetType: 'team', targetId: teamId, meta: { fields: Object.keys(input) } });
    await this.emitTeam(teamId);
    return this.get(me, teamId);
  }

  async setArchived(me: string, teamId: string, archived: boolean): Promise<TeamInfo> {
    await this.requireTeamRole(me, teamId, ['owner']);
    await this.prisma.team.update({ where: { id: teamId }, data: { archivedAt: archived ? new Date() : null } });
    this.audit.log({ actorId: me, action: archived ? 'team.archived' : 'team.unarchived', targetType: 'team', targetId: teamId });
    await this.emitTeam(teamId);
    return this.get(me, teamId);
  }

  async remove(actor: Actor, teamId: string): Promise<void> {
    if (actor.role !== 'admin') await this.requireTeamRole(actor.id, teamId, ['owner']);
    const audience = await this.teamAudience(teamId);
    await this.prisma.team.update({ where: { id: teamId }, data: { deletedAt: new Date() } });
    this.audit.log({ actorId: actor.id, action: 'team.deleted', targetType: 'team', targetId: teamId });
    this.realtime.toUsers(audience, WS_EVENTS.teamUpdated, { teamId, removed: true } satisfies TeamUpdatedEvent);
  }

  async restore(actor: Actor, teamId: string): Promise<TeamInfo> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, include: { members: { where: { userId: actor.id } } } });
    if (!team?.deletedAt || (actor.role !== 'admin' && team.members[0]?.role !== 'owner')) throw new NotFoundException('Team not found');
    await this.prisma.team.update({ where: { id: teamId }, data: { deletedAt: null } });
    this.audit.log({ actorId: actor.id, action: 'team.restored', targetType: 'team', targetId: teamId });
    await this.emitTeam(teamId);
    return this.get(actor.id, teamId);
  }

  /** Teams I own that were deleted within the retention period. */
  async deletedTeams(me: string) {
    const rows = await this.prisma.team.findMany({
      where: { deletedAt: { not: null }, members: { some: { userId: me, role: 'owner' } } },
      orderBy: { deletedAt: 'desc' },
    });
    return rows.map((t) => ({ id: t.id, name: t.name, deletedAt: t.deletedAt!.toISOString(), purgeAt: new Date(t.deletedAt!.getTime() + DELETED_RETENTION_DAYS * DAY).toISOString() }));
  }

  // ------------------------------------------------------------------ personal team settings

  async setHidden(me: string, teamId: string, hidden: boolean): Promise<TeamInfo> {
    await this.requireTeamRole(me, teamId);
    await this.prisma.teamMember.update({ where: { teamId_userId: { teamId, userId: me } }, data: { hidden } });
    this.realtime.toUsers([me], WS_EVENTS.teamUpdated, { teamId } satisfies TeamUpdatedEvent);
    return this.get(me, teamId);
  }

  async reorder(me: string, teamIds: string[]): Promise<void> {
    await this.prisma.$transaction(
      teamIds.map((teamId, position) => this.prisma.teamMember.updateMany({ where: { teamId, userId: me }, data: { position } })),
    );
    this.realtime.toUsers([me], WS_EVENTS.teamUpdated, { teamId: teamIds[0] ?? '' } satisfies TeamUpdatedEvent);
  }

  // ------------------------------------------------------------------ discovery & joining

  async discover(me: string, q = ''): Promise<DiscoverTeam[]> {
    const term = q.trim();
    const rows = await this.prisma.team.findMany({
      where: {
        visibility: 'public',
        deletedAt: null,
        archivedAt: null,
        members: { none: { userId: me } },
        ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { description: { contains: term, mode: 'insensitive' } }] } : {}),
      },
      include: { _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
      take: 50,
    });
    return rows.map((t) => ({ id: t.id, name: t.name, description: t.description, memberCount: t._count.members }));
  }

  async join(me: string, teamId: string): Promise<TeamInfo> {
    const team = await this.prisma.team.findFirst({ where: { id: teamId, deletedAt: null, archivedAt: null, visibility: 'public' } });
    if (!team) throw new NotFoundException('Team not found');
    return this.joinTeam(me, team);
  }

  async joinByCode(me: string, code: string): Promise<TeamInfo> {
    const team = await this.prisma.team.findFirst({ where: { joinCode: code.toUpperCase(), deletedAt: null, archivedAt: null } });
    if (!team) throw new NotFoundException('That code didn’t match a team');
    return this.joinTeam(me, team);
  }

  async setJoinCode(me: string, teamId: string, enabled: boolean): Promise<TeamInfo> {
    await this.requireTeamRole(me, teamId, ['owner']);
    for (let attempt = 0; ; attempt++) {
      try {
        await this.prisma.team.update({ where: { id: teamId }, data: { joinCode: enabled ? generateJoinCode() : null } });
        break;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') || attempt > 3) throw e;
      }
    }
    this.audit.log({ actorId: me, action: enabled ? 'team.join_code_reset' : 'team.join_code_removed', targetType: 'team', targetId: teamId });
    return this.get(me, teamId);
  }

  private async joinTeam(me: string, team: Team): Promise<TeamInfo> {
    const existing = await this.prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: team.id, userId: me } } });
    if (!existing) {
      await this.prisma.teamMember.create({ data: { teamId: team.id, userId: me, role: 'member' } });
      await this.syncTeamChannels(team.id);
      this.audit.log({ actorId: me, action: 'team.joined', targetType: 'team', targetId: team.id });
      await this.emitTeam(team.id);
    }
    return this.get(me, team.id);
  }

  // ------------------------------------------------------------------ team members

  async members(me: string, teamId: string): Promise<TeamMemberInfo[]> {
    await this.requireTeamRole(me, teamId);
    const rows = await this.prisma.teamMember.findMany({
      where: { teamId },
      include: { user: { select: USER_SELECT } },
      orderBy: [{ role: 'asc' }, { user: { displayName: 'asc' } }],
    });
    const presence = await this.presence.getMany(rows.map((r) => r.userId));
    return rows.map((r) => ({ user: toUserSummary(r.user, presence.get(r.userId)), role: r.role }));
  }

  async addMembers(me: string, teamId: string, userIds: string[], role: TeamRole): Promise<TeamMemberInfo[]> {
    await this.requireTeamRole(me, teamId, ['owner']);
    const existing = new Set((await this.prisma.teamMember.findMany({ where: { teamId }, select: { userId: true } })).map((m) => m.userId));
    const added = (await this.activeUserIds([...new Set(userIds)])).filter((id) => !existing.has(id));
    if (added.length) {
      await this.prisma.teamMember.createMany({ data: added.map((userId) => ({ teamId, userId, role })) });
      await this.syncTeamChannels(teamId);
      await this.notifyTeamAdd(teamId, me, added);
      this.audit.log({ actorId: me, action: 'team.members_added', targetType: 'team', targetId: teamId, meta: { userIds: added, role } });
      await this.emitTeam(teamId);
    }
    return this.members(me, teamId);
  }

  async setMemberRole(me: string, teamId: string, userId: string, role: TeamRole): Promise<TeamMemberInfo[]> {
    await this.requireTeamRole(me, teamId, ['owner']);
    const owners = await this.ownerIds(teamId);
    if (wouldLeaveNoOwner(owners, userId, role)) throw new BadRequestException('A team needs at least one owner');
    const updated = await this.prisma.teamMember.updateMany({ where: { teamId, userId }, data: { role } });
    if (!updated.count) throw new NotFoundException('Not a member of this team');
    this.audit.log({ actorId: me, action: 'team.member_role_changed', targetType: 'team', targetId: teamId, meta: { userId, role } });
    await this.emitTeam(teamId);
    return this.members(me, teamId);
  }

  async removeMember(me: string, teamId: string, userId: string): Promise<void> {
    const { team } = await this.requireTeamRole(me, teamId, userId === me ? undefined : ['owner']);
    if (team.visibility === 'orgwide' && userId === me) throw new BadRequestException('You can’t leave an org-wide team');
    if (wouldLeaveNoOwner(await this.ownerIds(teamId), userId, null)) {
      throw new BadRequestException('Make someone else an owner before leaving');
    }
    const audience = await this.teamAudience(teamId);
    await this.prisma.$transaction([
      this.prisma.teamMember.deleteMany({ where: { teamId, userId } }),
      // Private channels require team membership; shared-channel seats are independent of the team.
      this.prisma.channelMember.deleteMany({ where: { userId, channel: { teamId, type: 'private' } } }),
      this.prisma.tagMember.deleteMany({ where: { userId, tag: { teamId } } }),
    ]);
    await this.syncTeamChannels(teamId);
    this.audit.log({ actorId: me, action: userId === me ? 'team.left' : 'team.member_removed', targetType: 'team', targetId: teamId, meta: { userId } });
    this.realtime.toUsers(audience, WS_EVENTS.teamUpdated, { teamId } satisfies TeamUpdatedEvent);
  }

  // ------------------------------------------------------------------ channels

  async createChannel(me: string, teamId: string, input: CreateChannelInput & { type: ChannelInfo['type']; memberIds: string[] }): Promise<ChannelInfo> {
    const { team, role } = await this.requireTeamRole(me, teamId);
    if (team.archivedAt) throw new BadRequestException('This team is archived');
    if (!canCreateChannel(role, input.type, parseTeamSettings(team.settings))) throw new ForbiddenException('You can’t create this kind of channel here');
    const count = await this.prisma.channel.count({ where: { teamId, deletedAt: null } });
    if (count >= MAX_CHANNELS_PER_TEAM) throw new BadRequestException(`Teams are limited to ${MAX_CHANNELS_PER_TEAM} channels`);
    await this.assertChannelNameFree(teamId, input.name);

    const channel = await this.createChannelRow(team, me, { name: input.name, description: input.description, type: input.type });
    if (input.type !== 'standard') {
      const teamMembers = new Set((await this.prisma.teamMember.findMany({ where: { teamId }, select: { userId: true } })).map((m) => m.userId));
      // Private channels draw from the team; shared channels may include anyone in the organization.
      const candidates = (await this.activeUserIds([...new Set(input.memberIds)])).filter((id) => id !== me && (input.type === 'shared' || teamMembers.has(id)));
      await this.prisma.channelMember.createMany({
        data: [{ channelId: channel.id, userId: me, role: 'owner' }, ...candidates.map((userId) => ({ channelId: channel.id, userId }))],
      });
    }
    await this.syncChannelMembers(channel.id);
    this.audit.log({ actorId: me, action: 'channel.created', targetType: 'channel', targetId: channel.id, meta: { teamId, type: input.type } });
    return this.channelInfoFor(me, channel.id);
  }

  async updateChannel(me: string, channelId: string, input: UpdateChannelInput): Promise<ChannelInfo> {
    const access = await this.requireChannel(me, channelId);
    if (!access.permissions.manage) throw new ForbiddenException('Only owners can change this channel');
    const { channel } = access;
    if (input.name && input.name !== channel.name) {
      if (channel.isGeneral) throw new BadRequestException('The General channel can’t be renamed');
      await this.assertChannelNameFree(channel.teamId, input.name, channel.id);
    }
    const moderation = input.moderation ? { ...access.moderation, ...input.moderation } : undefined;
    const updated = await this.prisma.channel.update({
      where: { id: channelId },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(moderation ? { moderation } : {}),
      },
    });
    if (input.name) await this.prisma.conversation.update({ where: { id: channel.conversationId }, data: { title: `${access.team.name} › ${updated.name}` } });
    this.audit.log({ actorId: me, action: 'channel.updated', targetType: 'channel', targetId: channelId, meta: { fields: Object.keys(input) } });
    await this.emitChannel(channel);
    return this.channelInfoFor(me, channelId);
  }

  async setChannelArchived(me: string, channelId: string, archived: boolean): Promise<ChannelInfo> {
    const access = await this.requireChannel(me, channelId);
    if (!access.permissions.manage) throw new ForbiddenException('Only owners can archive this channel');
    if (access.channel.isGeneral) throw new BadRequestException('The General channel can’t be archived');
    await this.prisma.channel.update({ where: { id: channelId }, data: { archivedAt: archived ? new Date() : null } });
    this.audit.log({ actorId: me, action: archived ? 'channel.archived' : 'channel.unarchived', targetType: 'channel', targetId: channelId });
    await this.emitChannel(access.channel);
    return this.channelInfoFor(me, channelId);
  }

  async deleteChannel(me: string, channelId: string): Promise<void> {
    const access = await this.requireChannel(me, channelId);
    if (!access.permissions.manage) throw new ForbiddenException('Only owners can delete this channel');
    if (access.channel.isGeneral) throw new BadRequestException('The General channel can’t be deleted');
    const audience = await this.conversationMemberIds(access.channel.conversationId);
    await this.prisma.channel.update({ where: { id: channelId }, data: { deletedAt: new Date() } });
    this.audit.log({ actorId: me, action: 'channel.deleted', targetType: 'channel', targetId: channelId });
    this.realtime.toUsers(audience, WS_EVENTS.channelUpdated, { channelId, teamId: access.channel.teamId, removed: true } satisfies ChannelUpdatedEvent);
  }

  async restoreChannel(me: string, channelId: string): Promise<ChannelInfo> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel?.deletedAt) throw new NotFoundException('Channel not found');
    await this.requireTeamRole(me, channel.teamId, ['owner']);
    await this.assertChannelNameFree(channel.teamId, channel.name, channel.id);
    await this.prisma.channel.update({ where: { id: channelId }, data: { deletedAt: null } });
    await this.syncChannelMembers(channelId);
    this.audit.log({ actorId: me, action: 'channel.restored', targetType: 'channel', targetId: channelId });
    await this.emitChannel(channel);
    return this.channelInfoFor(me, channelId);
  }

  async deletedChannels(me: string, teamId: string): Promise<RecycledChannel[]> {
    await this.requireTeamRole(me, teamId, ['owner']);
    const rows = await this.prisma.channel.findMany({ where: { teamId, deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' } });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      deletedAt: c.deletedAt!.toISOString(),
      purgeAt: new Date(c.deletedAt!.getTime() + DELETED_RETENTION_DAYS * DAY).toISOString(),
    }));
  }

  /** All live channels of a team that I can see, plus the names of private ones I can't (owners manage them). */
  async teamChannels(me: string, teamId: string) {
    const { role } = await this.requireTeamRole(me, teamId);
    const rows = await this.prisma.channel.findMany({
      where: { teamId, deletedAt: null },
      include: { _count: { select: { members: true } } },
      orderBy: [{ isGeneral: 'desc' }, { name: 'asc' }],
    });
    const visible = new Set(
      (await this.prisma.conversationMember.findMany({ where: { userId: me, conversationId: { in: rows.map((r) => r.conversationId) } }, select: { conversationId: true } })).map(
        (r) => r.conversationId,
      ),
    );
    return rows
      .filter((c) => role === 'owner' || c.type === 'standard' || visible.has(c.conversationId))
      .map((c) => ({ id: c.id, name: c.name, type: c.type, description: c.description, isGeneral: c.isGeneral, archivedAt: c.archivedAt?.toISOString() ?? null, memberCount: c._count.members, canOpen: visible.has(c.conversationId) }));
  }

  async setMyChannelSettings(me: string, channelId: string, input: { pinned?: boolean; muted?: boolean }): Promise<ChannelInfo> {
    const { channel } = await this.requireChannel(me, channelId);
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: channel.conversationId, userId: me } },
      data: input,
    });
    return this.emitMyChannel(me, channelId);
  }

  async markRead(me: string, channelId: string): Promise<ChannelInfo> {
    const { channel } = await this.requireChannel(me, channelId);
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: channel.conversationId, userId: me } },
      data: { lastReadAt: new Date() },
    });
    return this.emitMyChannel(me, channelId);
  }

  // ------------------------------------------------------------------ channel members & sharing

  async channelMembers(me: string, channelId: string): Promise<ChannelMemberInfo[]> {
    const { channel } = await this.requireChannel(me, channelId);
    const ids = await this.conversationMemberIds(channel.conversationId);
    const [users, explicit, teamMembers] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: USER_SELECT, orderBy: { displayName: 'asc' } }),
      this.prisma.channelMember.findMany({ where: { channelId } }),
      this.prisma.teamMember.findMany({ where: { teamId: channel.teamId }, select: { userId: true } }),
    ]);
    const roles = new Map(explicit.map((m) => [m.userId, m.role as 'owner' | 'member']));
    const inTeam = new Set(teamMembers.map((m) => m.userId));
    const presence = await this.presence.getMany(ids);
    return users.map((u) => ({
      user: toUserSummary(u, presence.get(u.id)),
      role: roles.get(u.id) ?? 'team',
      external: !inTeam.has(u.id),
    }));
  }

  async addChannelMembers(me: string, channelId: string, userIds: string[], role: 'owner' | 'member'): Promise<ChannelMemberInfo[]> {
    const access = await this.requireChannel(me, channelId);
    const { channel } = access;
    if (channel.type === 'standard') throw new BadRequestException('Everyone in the team is in standard channels; add people to the team instead');
    if (!access.permissions.manage) throw new ForbiddenException('Only channel owners can add people');
    let candidates = await this.activeUserIds([...new Set(userIds)]);
    if (channel.type === 'private') {
      const teamMembers = new Set((await this.prisma.teamMember.findMany({ where: { teamId: channel.teamId }, select: { userId: true } })).map((m) => m.userId));
      if (candidates.some((id) => !teamMembers.has(id))) throw new BadRequestException('People must be in the team before joining a private channel');
      candidates = candidates.filter((id) => teamMembers.has(id));
    }
    for (const userId of candidates) {
      await this.prisma.channelMember.upsert({
        where: { channelId_userId: { channelId, userId } },
        create: { channelId, userId, role },
        update: { role },
      });
    }
    await this.syncChannelMembers(channelId);
    this.audit.log({ actorId: me, action: 'channel.members_added', targetType: 'channel', targetId: channelId, meta: { userIds: candidates, role } });
    return this.channelMembers(me, channelId);
  }

  async removeChannelMember(me: string, channelId: string, userId: string): Promise<void> {
    const access = await this.requireChannel(me, channelId);
    if (access.channel.type === 'standard') throw new BadRequestException('Remove the person from the team instead');
    if (userId !== me && !access.permissions.manage) throw new ForbiddenException('Only channel owners can remove people');
    const owners = (await this.prisma.channelMember.findMany({ where: { channelId, role: 'owner' } })).map((m) => m.userId);
    if (owners.length === 1 && owners[0] === userId) throw new BadRequestException('A channel needs at least one owner');
    await this.prisma.channelMember.deleteMany({ where: { channelId, userId } });
    await this.syncChannelMembers(channelId);
    this.audit.log({ actorId: me, action: 'channel.member_removed', targetType: 'channel', targetId: channelId, meta: { userId } });
  }

  async shareChannel(me: string, channelId: string, teamId: string, share: boolean): Promise<ChannelInfo> {
    const access = await this.requireChannel(me, channelId);
    if (access.channel.type !== 'shared') throw new BadRequestException('Only shared channels can be shared with other teams');
    if (!access.permissions.manage) throw new ForbiddenException('Only channel owners can share this channel');
    // The person sharing must own the receiving team, so nobody can push a channel into a team they don't run.
    if (share) await this.requireTeamRole(me, teamId, ['owner']);
    if (share) {
      await this.prisma.channelShare.upsert({ where: { channelId_teamId: { channelId, teamId } }, create: { channelId, teamId }, update: {} });
    } else {
      await this.prisma.channelShare.deleteMany({ where: { channelId, teamId } });
    }
    await this.syncChannelMembers(channelId);
    this.audit.log({ actorId: me, action: share ? 'channel.shared' : 'channel.unshared', targetType: 'channel', targetId: channelId, meta: { teamId } });
    this.realtime.toUsers(await this.teamAudience(teamId), WS_EVENTS.teamUpdated, { teamId } satisfies TeamUpdatedEvent);
    return this.channelInfoFor(me, channelId);
  }

  async channelShares(me: string, channelId: string) {
    await this.requireChannel(me, channelId);
    const rows = await this.prisma.channelShare.findMany({ where: { channelId }, include: { team: { select: { id: true, name: true } } } });
    return rows.map((r) => r.team);
  }

  // ------------------------------------------------------------------ tags

  async tags(me: string, teamId: string): Promise<TagInfo[]> {
    await this.requireTeamRole(me, teamId);
    return this.tagsOf(teamId);
  }

  async tagsOf(teamId: string): Promise<TagInfo[]> {
    const rows = await this.prisma.tag.findMany({ where: { teamId }, include: { members: true }, orderBy: { name: 'asc' } });
    return rows.map((t) => ({ id: t.id, teamId: t.teamId, name: t.name, memberIds: t.members.map((m) => m.userId) }));
  }

  async createTag(me: string, teamId: string, name: string, userIds: string[]): Promise<TagInfo[]> {
    await this.requireTagManager(me, teamId);
    const members = await this.teamMemberIds(teamId, userIds);
    try {
      await this.prisma.tag.create({ data: { teamId, name, members: { create: members.map((userId) => ({ userId })) } } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A tag with that name already exists');
      throw e;
    }
    this.audit.log({ actorId: me, action: 'team.tag_created', targetType: 'team', targetId: teamId, meta: { name } });
    return this.tagsOf(teamId);
  }

  async updateTag(me: string, tagId: string, input: { name?: string; userIds?: string[] }): Promise<TagInfo[]> {
    const tag = await this.prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw new NotFoundException('Tag not found');
    await this.requireTagManager(me, tag.teamId);
    const members = input.userIds ? await this.teamMemberIds(tag.teamId, input.userIds) : null;
    await this.prisma.tag.update({
      where: { id: tagId },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(members ? { members: { deleteMany: {}, create: members.map((userId) => ({ userId })) } } : {}),
      },
    });
    return this.tagsOf(tag.teamId);
  }

  async deleteTag(me: string, tagId: string): Promise<TagInfo[]> {
    const tag = await this.prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw new NotFoundException('Tag not found');
    await this.requireTagManager(me, tag.teamId);
    await this.prisma.tag.delete({ where: { id: tagId } });
    return this.tagsOf(tag.teamId);
  }

  // ------------------------------------------------------------------ access helpers (also used by ChannelPostsService)

  async requireChannel(me: string, channelId: string): Promise<ChannelAccess> {
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, deletedAt: null }, include: { team: true } });
    if (!channel || channel.team.deletedAt) throw new NotFoundException('Channel not found');
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: channel.conversationId, userId: me } },
    });
    if (!member) throw new NotFoundException('Channel not found');
    const [teamMember, channelMember] = await Promise.all([
      this.prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: channel.teamId, userId: me } } }),
      this.prisma.channelMember.findUnique({ where: { channelId_userId: { channelId, userId: me } } }),
    ]);
    const { team, ...rest } = channel;
    const settings = parseTeamSettings(team.settings);
    const moderation = parseModeration(channel.moderation);
    const teamRole = teamMember?.role ?? null;
    const channelRole = (channelMember?.role as 'owner' | 'member' | undefined) ?? null;
    return {
      channel: rest as Channel,
      team,
      teamRole,
      channelRole,
      settings,
      moderation,
      permissions: channelPermissions({
        userId: me,
        teamRole,
        channelRole,
        channelType: channel.type,
        moderation,
        settings,
        archived: !!channel.archivedAt || !!team.archivedAt,
      }),
    };
  }

  async channelInfoFor(me: string, channelId: string): Promise<ChannelInfo> {
    const access = await this.requireChannel(me, channelId);
    const pref = await this.prisma.conversationMember.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: access.channel.conversationId, userId: me } },
    });
    const [unread, lastAt] = await Promise.all([
      this.unreadCounts(me, [access.channel.conversationId]),
      this.lastMessageAt([access.channel]),
    ]);
    return this.toChannelInfo(access.channel, access.team, access.teamRole, access.channelRole, {
      me,
      unread: unread.get(access.channel.conversationId),
      pinned: pref.pinned,
      muted: pref.muted,
      lastMessageAt: lastAt.get(access.channel.conversationId) ?? access.channel.createdAt,
      sharedFrom: null,
    });
  }

  async conversationMemberIds(conversationId: string): Promise<string[]> {
    const rows = await this.prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  /** Activity feed entry; types beyond chat's are 'team_add' and 'channel_mention'. */
  async notify(userId: string, type: string, actorId: string, conversationId: string, messageId: string | null, preview: string) {
    const row = await this.prisma.notification.create({
      data: { userId, type, actorId, conversationId, messageId, preview },
      include: { actor: { select: { id: true, displayName: true, avatarKey: true } }, conversation: { select: { id: true, title: true } } },
    });
    const item: ActivityItem = {
      id: row.id,
      type: row.type as ActivityItem['type'],
      actor: row.actor ? { id: row.actor.id, displayName: row.actor.displayName, avatarUrl: avatarUrl(row.actor) } : null,
      conversationId: row.conversationId,
      conversationTitle: row.conversation?.title ?? null,
      messageId: row.messageId,
      preview: row.preview,
      read: false,
      createdAt: row.createdAt.toISOString(),
    };
    this.realtime.toUsers([userId], WS_EVENTS.notificationNew, item);
  }

  // ------------------------------------------------------------------ membership sync

  /**
   * Who can read a channel: the whole team (standard), the explicit members (private), or the explicit members plus
   * every member of the teams it's shared with (shared). Mirrored into ConversationMember so chat features
   * (reactions, edits, attachments, typing, read state) work on channel posts unchanged.
   */
  async syncChannelMembers(channelId: string): Promise<void> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId }, include: { members: true, shares: true } });
    if (!channel) return;
    const expected = new Set<string>();
    if (channel.type === 'standard') {
      (await this.prisma.teamMember.findMany({ where: { teamId: channel.teamId }, select: { userId: true } })).forEach((m) => expected.add(m.userId));
    } else {
      channel.members.forEach((m) => expected.add(m.userId));
      if (channel.type === 'shared' && channel.shares.length) {
        (await this.prisma.teamMember.findMany({ where: { teamId: { in: channel.shares.map((s) => s.teamId) } }, select: { userId: true } })).forEach((m) =>
          expected.add(m.userId),
        );
      }
    }
    const current = new Set(await this.conversationMemberIds(channel.conversationId));
    const added = [...expected].filter((id) => !current.has(id));
    const removed = [...current].filter((id) => !expected.has(id));
    const now = new Date();
    if (added.length) {
      await this.prisma.conversationMember.createMany({
        data: added.map((userId) => ({ conversationId: channel.conversationId, userId, lastReadAt: now })),
        skipDuplicates: true,
      });
    }
    if (removed.length) await this.prisma.conversationMember.deleteMany({ where: { conversationId: channel.conversationId, userId: { in: removed } } });
    if (added.length) this.realtime.toUsers(added, WS_EVENTS.channelUpdated, { channelId, teamId: channel.teamId } satisfies ChannelUpdatedEvent);
    if (removed.length) this.realtime.toUsers(removed, WS_EVENTS.channelUpdated, { channelId, teamId: channel.teamId, removed: true } satisfies ChannelUpdatedEvent);
  }

  /** After team membership changes: the team's standard channels and shared channels that are shared into it. */
  private async syncTeamChannels(teamId: string) {
    const channels = await this.prisma.channel.findMany({
      where: { OR: [{ teamId }, { shares: { some: { teamId } } }] },
      select: { id: true },
    });
    for (const c of channels) await this.syncChannelMembers(c.id);
  }

  private async ensureOrgWideMemberships(me: string) {
    const missing = await this.prisma.team.findMany({
      where: { visibility: 'orgwide', deletedAt: null, members: { none: { userId: me } } },
      select: { id: true },
    });
    if (!missing.length) return;
    const user = await this.prisma.user.findUnique({ where: { id: me }, select: { isActive: true, role: true } });
    if (!user?.isActive || user.role === 'guest') return;
    await this.prisma.teamMember.createMany({ data: missing.map((t) => ({ teamId: t.id, userId: me })), skipDuplicates: true });
    for (const t of missing) await this.syncTeamChannels(t.id);
  }

  // ------------------------------------------------------------------ internals

  private async createChannelRow(
    team: Team,
    me: string,
    c: { name: string; description?: string | null; type: Channel['type']; isGeneral?: boolean; moderation?: Prisma.InputJsonValue },
  ) {
    const conversation = await this.prisma.conversation.create({ data: { type: 'channel', title: `${team.name} › ${c.name}`, createdById: me } });
    return this.prisma.channel.create({
      data: {
        teamId: team.id,
        name: c.name,
        description: c.description || null,
        type: c.type,
        isGeneral: !!c.isGeneral,
        conversationId: conversation.id,
        moderation: c.moderation ?? {},
        createdById: me,
      },
    });
  }

  private async retitleConversations(team: Team) {
    const channels = await this.prisma.channel.findMany({ where: { teamId: team.id }, select: { conversationId: true, name: true } });
    await this.prisma.$transaction(
      channels.map((c) => this.prisma.conversation.update({ where: { id: c.conversationId }, data: { title: `${team.name} › ${c.name}` } })),
    );
  }

  private async notifyTeamAdd(teamId: string, actorId: string, userIds: string[]) {
    const general = await this.prisma.channel.findFirst({ where: { teamId, isGeneral: true }, include: { team: true } });
    if (!general) return;
    for (const userId of userIds.filter((u) => u !== actorId)) {
      await this.notify(userId, 'team_add', actorId, general.conversationId, null, `Added you to the team ${general.team.name}`);
    }
  }

  private async requireTeamRole(me: string, teamId: string, roles?: TeamRole[]) {
    const team = await this.prisma.team.findFirst({ where: { id: teamId, deletedAt: null } });
    if (!team) throw new NotFoundException('Team not found');
    const member = await this.prisma.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: me } } });
    if (!member) throw new NotFoundException('Team not found');
    if (roles && !roles.includes(member.role)) throw new ForbiddenException('Only team owners can do that');
    return { team, role: member.role };
  }

  private async requireTagManager(me: string, teamId: string) {
    const { team, role } = await this.requireTeamRole(me, teamId);
    if (!canManageTags(role, parseTeamSettings(team.settings))) throw new ForbiddenException('Only owners can manage tags in this team');
  }

  private async teamMemberIds(teamId: string, userIds: string[]) {
    const rows = await this.prisma.teamMember.findMany({ where: { teamId, userId: { in: userIds } }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  private async ownerIds(teamId: string) {
    return (await this.prisma.teamMember.findMany({ where: { teamId, role: 'owner' }, select: { userId: true } })).map((m) => m.userId);
  }

  private async activeUserIds(ids: string[]) {
    if (!ids.length) return [];
    return (await this.prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } })).map((u) => u.id);
  }

  private async assertChannelNameFree(teamId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.channel.findFirst({
      where: { teamId, deletedAt: null, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (clash) throw new ConflictException('A channel with that name already exists');
  }

  /** Team members plus anyone who reaches one of its channels through sharing. */
  private async teamAudience(teamId: string) {
    const [members, channels] = await Promise.all([
      this.prisma.teamMember.findMany({ where: { teamId }, select: { userId: true } }),
      this.prisma.channel.findMany({ where: { teamId }, select: { conversationId: true } }),
    ]);
    const viaChannels = await this.prisma.conversationMember.findMany({
      where: { conversationId: { in: channels.map((c) => c.conversationId) } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return [...new Set([...members.map((m) => m.userId), ...viaChannels.map((m) => m.userId)])];
  }

  private async emitTeam(teamId: string) {
    this.realtime.toUsers(await this.teamAudience(teamId), WS_EVENTS.teamUpdated, { teamId } satisfies TeamUpdatedEvent);
  }

  private async emitChannel(channel: { id: string; teamId: string; conversationId: string }) {
    this.realtime.toUsers(await this.conversationMemberIds(channel.conversationId), WS_EVENTS.channelUpdated, {
      channelId: channel.id,
      teamId: channel.teamId,
    } satisfies ChannelUpdatedEvent);
  }

  private async emitMyChannel(me: string, channelId: string) {
    const info = await this.channelInfoFor(me, channelId);
    this.realtime.toUsers([me], WS_EVENTS.channelUpdated, { channelId, teamId: info.teamId, channel: info } satisfies ChannelUpdatedEvent);
    return info;
  }

  private async unreadCounts(me: string, conversationIds: string[]) {
    const out = new Map<string, { unread: number; mentions: number }>();
    if (!conversationIds.length) return out;
    const rows = await this.prisma.$queryRaw<{ conversationId: string; unread: number; mentions: number }[]>`
      SELECT cm."conversationId", COUNT(m.id)::int AS unread, COUNT(mn."userId")::int AS mentions
      FROM "ConversationMember" cm
      JOIN "Message" m ON m."conversationId" = cm."conversationId"
        AND m."createdAt" > COALESCE(cm."lastReadAt", cm."joinedAt")
        AND m."authorId" IS DISTINCT FROM cm."userId"
        AND m."deletedAt" IS NULL
        AND m."type" = 'text'
      LEFT JOIN "Mention" mn ON mn."messageId" = m.id AND mn."userId" = cm."userId"
      WHERE cm."userId" = ${me} AND cm."conversationId" IN (${Prisma.join(conversationIds)})
      GROUP BY cm."conversationId"`;
    for (const r of rows) out.set(r.conversationId, { unread: r.unread, mentions: r.mentions });
    return out;
  }

  private async lastMessageAt(channels: { conversationId: string }[]) {
    if (!channels.length) return new Map<string, Date>();
    const rows = await this.prisma.conversation.findMany({
      where: { id: { in: channels.map((c) => c.conversationId) } },
      select: { id: true, lastMessageAt: true },
    });
    return new Map(rows.map((r) => [r.id, r.lastMessageAt]));
  }

  private toChannelInfo(
    c: Channel,
    team: Team,
    teamRole: TeamRole | null,
    channelRole: 'owner' | 'member' | null,
    extra: { me: string; unread?: { unread: number; mentions: number }; pinned: boolean; muted: boolean; lastMessageAt: Date; sharedFrom: ChannelInfo['sharedFrom'] },
  ): ChannelInfo {
    const moderation = parseModeration(c.moderation);
    const settings = parseTeamSettings(team.settings);
    return {
      id: c.id,
      teamId: c.teamId,
      name: c.name,
      description: c.description,
      type: c.type,
      isGeneral: c.isGeneral,
      conversationId: c.conversationId,
      moderation,
      archivedAt: c.archivedAt?.toISOString() ?? null,
      deletedAt: c.deletedAt?.toISOString() ?? null,
      unread: extra.unread?.unread ?? 0,
      unreadMentions: extra.unread?.mentions ?? 0,
      pinned: extra.pinned,
      muted: extra.muted,
      myRole: channelRole,
      sharedFrom: extra.sharedFrom,
      permissions: channelPermissions({
        userId: extra.me,
        teamRole,
        channelRole,
        channelType: c.type,
        moderation,
        settings,
        archived: !!c.archivedAt || !!team.archivedAt,
      }),
      lastMessageAt: extra.lastMessageAt.toISOString(),
    };
  }

  private toTeamInfo(team: Team, role: TeamRole | null, memberCount: number, hidden: boolean, position: number, channels: ChannelInfo[]): TeamInfo {
    return {
      id: team.id,
      name: team.name,
      description: team.description,
      visibility: team.visibility,
      myRole: role,
      joinCode: role === 'owner' ? team.joinCode : null,
      settings: parseTeamSettings(team.settings),
      memberCount,
      archivedAt: team.archivedAt?.toISOString() ?? null,
      deletedAt: team.deletedAt?.toISOString() ?? null,
      hidden,
      position,
      channels,
      createdAt: team.createdAt.toISOString(),
    };
  }

  private async purgeDeleted() {
    const cutoff = new Date(Date.now() - DELETED_RETENTION_DAYS * DAY);
    const channels = await this.prisma.channel.findMany({
      where: { OR: [{ deletedAt: { lt: cutoff } }, { team: { deletedAt: { lt: cutoff } } }] },
      select: { id: true, conversationId: true },
    });
    for (const c of channels) {
      // Conversation delete cascades to messages, reactions, mentions and attachment rows.
      await this.prisma.$transaction([
        this.prisma.channel.delete({ where: { id: c.id } }),
        this.prisma.conversation.deleteMany({ where: { id: c.conversationId } }),
      ]);
    }
    const teams = await this.prisma.team.deleteMany({ where: { deletedAt: { lt: cutoff } } });
    if (channels.length || teams.count) this.logger.log(`Purged ${channels.length} channels and ${teams.count} teams past retention`);
  }
}
