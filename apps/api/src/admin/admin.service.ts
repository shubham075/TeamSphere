import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AdminChannelRow, AdminTeamRow, AdminUpdateUserInput, AdminUserRow, AuditPage, AuditQuery, AuditRow, UsageOverview,
} from '@teamsphere/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { TeamsService } from '../teams/teams.service';
import { toPublicUser } from '../users/users.mapper';
import { PolicyService } from './policy.service';

const DAY = 24 * 60 * 60 * 1000;

/** CSV cell: quoted when needed, and formula-looking values defused so spreadsheets don't execute them. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly teams: TeamsService,
    private readonly policies: PolicyService,
  ) {}

  async overview(): Promise<UsageOverview> {
    const since = new Date(Date.now() - 7 * DAY);
    const people = { guestMeetingId: null };
    const [active, disabled, admins, guests, activeLast7d, teams, channels, msgTotal, msg7, mtgTotal, mtg7, callTotal, call7, files] =
      await Promise.all([
        this.prisma.user.count({ where: { ...people, isActive: true } }),
        this.prisma.user.count({ where: { ...people, isActive: false } }),
        this.prisma.user.count({ where: { ...people, role: 'admin', isActive: true } }),
        this.prisma.user.count({ where: { ...people, role: 'guest', isActive: true } }),
        this.prisma.user.count({ where: { ...people, lastLoginAt: { gte: since } } }),
        this.prisma.team.count({ where: { deletedAt: null } }),
        this.prisma.channel.count({ where: { deletedAt: null, team: { deletedAt: null } } }),
        this.prisma.message.count({ where: { deletedAt: null, type: 'text' } }),
        this.prisma.message.count({ where: { deletedAt: null, type: 'text', createdAt: { gte: since } } }),
        this.prisma.meeting.count({ where: { cancelledAt: null } }),
        this.prisma.meeting.count({ where: { cancelledAt: null, createdAt: { gte: since } } }),
        this.prisma.call.count(),
        this.prisma.call.count({ where: { createdAt: { gte: since } } }),
        this.prisma.fileItem.aggregate({ where: { deletedAt: null, kind: 'file' }, _count: true, _sum: { size: true } }),
      ]);
    return {
      users: { active, disabled, admins, guests, activeLast7d },
      teams,
      channels,
      messages: { total: msgTotal, last7d: msg7 },
      meetings: { total: mtgTotal, last7d: mtg7 },
      calls: { total: callTotal, last7d: call7 },
      files: { count: files._count, bytes: files._sum.size ?? 0 },
    };
  }

  // ---------------------------------------------------------------- users

  async users(q: string, role?: string, status?: string): Promise<AdminUserRow[]> {
    const term = q.trim();
    const rows = await this.prisma.user.findMany({
      where: {
        guestMeetingId: null,
        ...(role === 'admin' || role === 'user' || role === 'guest' ? { role } : {}),
        ...(status === 'active' ? { isActive: true } : status === 'disabled' ? { isActive: false } : {}),
        ...(term
          ? {
              OR: [
                { displayName: { contains: term, mode: 'insensitive' } },
                { username: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
                { department: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { displayName: 'asc' },
      take: 500,
    });
    return rows.map((u) => ({ ...toPublicUser(u), lastLoginAt: u.lastLoginAt?.toISOString() ?? null }));
  }

  async updateUser(actorId: string, id: string, input: AdminUpdateUserInput): Promise<AdminUserRow> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.guestMeetingId) throw new NotFoundException('User not found');
    if (id === actorId && (input.isActive === false || (input.role && input.role !== 'admin'))) {
      throw new BadRequestException('You cannot disable or demote your own account');
    }
    if (user.role === 'admin' && ((input.role && input.role !== 'admin') || input.isActive === false)) {
      const otherAdmins = await this.prisma.user.count({ where: { role: 'admin', isActive: true, id: { not: id } } });
      if (!otherAdmins) throw new BadRequestException('The organization needs at least one active admin');
    }
    const updated = await this.prisma.user.update({ where: { id }, data: input });
    // Role and access changes take effect at once: existing sessions carry the old role in their tokens.
    if (input.isActive === false || (input.role && input.role !== user.role)) await this.sessions.revokeAll(id);
    const changes = Object.fromEntries(Object.entries(input).filter(([k, v]) => (user as Record<string, unknown>)[k] !== v));
    if (Object.keys(changes).length) {
      this.audit.log({ actorId, action: 'admin.user_updated', targetType: 'user', targetId: id, meta: changes as Prisma.InputJsonValue });
    }
    return { ...toPublicUser(updated), lastLoginAt: updated.lastLoginAt?.toISOString() ?? null };
  }

  // ---------------------------------------------------------------- teams & channels

  async teamsList(q: string): Promise<AdminTeamRow[]> {
    const term = q.trim();
    const rows = await this.prisma.team.findMany({
      where: term ? { name: { contains: term, mode: 'insensitive' } } : {},
      include: {
        members: { where: { role: 'owner' }, include: { user: { select: { id: true, displayName: true } } } },
        _count: { select: { members: true, channels: { where: { deletedAt: null } } } },
      },
      orderBy: { name: 'asc' },
      take: 500,
    });
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      visibility: t.visibility,
      memberCount: t._count.members,
      channelCount: t._count.channels,
      owners: t.members.map((m) => m.user),
      archivedAt: t.archivedAt?.toISOString() ?? null,
      deletedAt: t.deletedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async teamAction(actor: { id: string; role: 'admin' }, teamId: string, action: 'archive' | 'unarchive' | 'delete' | 'restore'): Promise<void> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Team not found');
    if (action === 'delete') {
      if (team.deletedAt) return;
      await this.teams.remove(actor, teamId);
    } else if (action === 'restore') {
      if (!team.deletedAt) return;
      await this.teams.restore(actor, teamId);
    } else {
      await this.prisma.team.update({ where: { id: teamId }, data: { archivedAt: action === 'archive' ? new Date() : null } });
      this.audit.log({ actorId: actor.id, action: action === 'archive' ? 'team.archived' : 'team.unarchived', targetType: 'team', targetId: teamId, meta: { byAdmin: true } });
      await this.teams.emitTeam(teamId);
    }
    this.policies.invalidate();
  }

  /** Make someone an owner (adding them to the team if needed), or demote an owner to member. */
  async setTeamOwner(actorId: string, teamId: string, userId: string, owner: boolean): Promise<void> {
    const [team, user] = await Promise.all([
      this.prisma.team.findFirst({ where: { id: teamId, deletedAt: null } }),
      this.prisma.user.findFirst({ where: { id: userId, isActive: true, guestMeetingId: null } }),
    ]);
    if (!team) throw new NotFoundException('Team not found');
    if (!user) throw new NotFoundException('User not found');
    if (owner) {
      await this.prisma.teamMember.upsert({
        where: { teamId_userId: { teamId, userId } },
        create: { teamId, userId, role: 'owner' },
        update: { role: 'owner' },
      });
      await this.teams.syncTeamChannels(teamId);
    } else {
      const owners = await this.prisma.teamMember.count({ where: { teamId, role: 'owner', userId: { not: userId } } });
      if (!owners) throw new BadRequestException('A team needs at least one owner');
      await this.prisma.teamMember.updateMany({ where: { teamId, userId }, data: { role: 'member' } });
    }
    this.audit.log({ actorId, action: 'team.member_role_changed', targetType: 'team', targetId: teamId, meta: { userId, role: owner ? 'owner' : 'member', byAdmin: true } });
    this.policies.invalidate(userId);
    await this.teams.emitTeam(teamId);
  }

  async channels(teamId: string): Promise<AdminChannelRow[]> {
    const rows = await this.prisma.channel.findMany({ where: { teamId }, orderBy: [{ isGeneral: 'desc' }, { name: 'asc' }] });
    return rows.map((c) => ({
      id: c.id,
      teamId: c.teamId,
      name: c.name,
      type: c.type,
      isGeneral: c.isGeneral,
      archivedAt: c.archivedAt?.toISOString() ?? null,
      deletedAt: c.deletedAt?.toISOString() ?? null,
    }));
  }

  async channelAction(actorId: string, channelId: string, action: 'archive' | 'unarchive' | 'delete' | 'restore'): Promise<void> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.isGeneral && action !== 'unarchive' && action !== 'restore') throw new BadRequestException('The General channel can’t be archived or deleted');
    const data =
      action === 'archive' ? { archivedAt: new Date() }
      : action === 'unarchive' ? { archivedAt: null }
      : action === 'delete' ? { deletedAt: new Date() }
      : { deletedAt: null };
    await this.prisma.channel.update({ where: { id: channelId }, data });
    const verb = { archive: 'archived', unarchive: 'unarchived', delete: 'deleted', restore: 'restored' }[action];
    this.audit.log({ actorId, action: `channel.${verb}`, targetType: 'channel', targetId: channelId, meta: { teamId: channel.teamId, byAdmin: true } });
    await this.teams.emitChannel(channel);
  }

  // ---------------------------------------------------------------- audit log

  async auditLog(query: AuditQuery): Promise<AuditPage> {
    const rows = await this.prisma.auditLog.findMany({
      where: this.auditWhere(query),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      include: { actor: { select: { id: true, displayName: true } } },
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    return { rows: page.map(toAuditRow), nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  /** Up to 50k rows matching the filters, as CSV. */
  async auditCsv(query: AuditQuery): Promise<string> {
    const rows = await this.prisma.auditLog.findMany({
      where: this.auditWhere(query),
      orderBy: { createdAt: 'desc' },
      take: 50_000,
      include: { actor: { select: { id: true, displayName: true } } },
    });
    const header = ['time', 'actor', 'actorId', 'action', 'targetType', 'targetId', 'ip', 'details'];
    const lines = rows.map(toAuditRow).map((r) =>
      [r.createdAt, r.actor?.displayName ?? '', r.actor?.id ?? '', r.action, r.targetType, r.targetId, r.ip, r.meta].map(csvCell).join(','),
    );
    return [header.join(','), ...lines].join('\r\n') + '\r\n';
  }

  private auditWhere(q: AuditQuery): Prisma.AuditLogWhereInput {
    return {
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
  }
}

function toAuditRow(r: {
  id: string; action: string; targetType: string | null; targetId: string | null; meta: Prisma.JsonValue; ip: string | null; createdAt: Date;
  actor: { id: string; displayName: string } | null;
}): AuditRow {
  return { id: r.id, action: r.action, actor: r.actor, targetType: r.targetType, targetId: r.targetId, meta: r.meta, ip: r.ip, createdAt: r.createdAt.toISOString() };
}
