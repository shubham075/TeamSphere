import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ChannelHit, FileHit, MeetingHit, MessageHit, SearchQuery, SearchResults, TeamHit } from '@teamsphere/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { toPublicUser } from '../users/users.mapper';
import { likePattern, messageVisible, stripMentionMarkup, toTsQuery } from './search.logic';

interface MessageRow {
  id: string;
  conversationId: string;
  parentId: string | null;
  type: string;
  createdAt: Date;
  deletedAt: Date | null;
  convType: string;
  convTitle: string | null;
  historySince: Date | null;
  channelId: string | null;
  channelName: string | null;
  channelDeletedAt: Date | null;
  teamName: string | null;
  teamDeletedAt: Date | null;
  authorId: string | null;
  authorName: string | null;
  snippet: string;
  hasAttachment: boolean;
}

const EMPTY: SearchResults = { people: [], messages: [], files: [], teams: [], channels: [], meetings: [] };

/**
 * Global search. Every section only returns what the caller can open: messages from conversations they're in (after
 * their historySince; channel membership, including private/shared channels, is mirrored as conversation membership),
 * files through FilesService's sharing rules, teams they're in or can discover, their channels and meetings.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  async search(me: string, q: SearchQuery): Promise<SearchResults> {
    const term = q.q.trim();
    const hasFilters = !!(q.from || q.in || q.after || q.before || q.hasAttachment !== undefined);
    if (!term && !hasFilters) return EMPTY;
    const want = (s: SearchQuery['scope']) => q.scope === 'all' || q.scope === s;
    // Filters only narrow messages; other sections need words to match.
    const words = !!term;
    const [people, messages, files, teams, channels, meetings] = await Promise.all([
      want('people') && words && !hasFilters ? this.people(term, q.limit) : [],
      want('messages') ? this.messages(me, q) : [],
      want('files') && words && !hasFilters ? this.fileHits(me, term, q.limit) : [],
      want('teams') && words && !hasFilters ? this.teams(me, term, q.limit) : [],
      want('channels') && words && !hasFilters ? this.channels(me, term, q.limit) : [],
      want('meetings') && words && !hasFilters ? this.meetings(me, term, q.limit) : [],
    ]);
    return { people, messages, files, teams, channels, meetings };
  }

  private async people(term: string, take: number) {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        guestMeetingId: null,
        OR: [
          { displayName: { contains: term, mode: 'insensitive' } },
          { username: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
          { jobTitle: { contains: term, mode: 'insensitive' } },
          { department: { contains: term, mode: 'insensitive' } },
        ],
      },
      orderBy: { displayName: 'asc' },
      take,
    });
    return users.map(toPublicUser);
  }

  async messages(me: string, q: SearchQuery): Promise<MessageHit[]> {
    const tsq = toTsQuery(q.q);
    if (q.q.trim() && !tsq) return [];
    const query = tsq ? Prisma.sql`to_tsquery('english', ${tsq})` : Prisma.sql`NULL::tsquery`;
    const conds: Prisma.Sql[] = [
      Prisma.sql`m."deletedAt" IS NULL`,
      Prisma.sql`m.type = 'text'`,
      Prisma.sql`(cm."historySince" IS NULL OR m."createdAt" >= cm."historySince")`,
      Prisma.sql`(ch.id IS NULL OR (ch."deletedAt" IS NULL AND t."deletedAt" IS NULL))`,
    ];
    if (tsq) {
      conds.push(Prisma.sql`(m."searchVector" @@ q.query OR EXISTS (
        SELECT 1 FROM "Attachment" a WHERE a."messageId" = m.id AND a."fileName" ILIKE ${likePattern(q.q)}))`);
    }
    if (q.from) conds.push(Prisma.sql`m."authorId" = ${q.from}`);
    if (q.in) conds.push(Prisma.sql`m."conversationId" = ${q.in}`);
    if (q.after) conds.push(Prisma.sql`m."createdAt" >= ${new Date(q.after)}`);
    if (q.before) conds.push(Prisma.sql`m."createdAt" < ${new Date(q.before)}`);
    if (q.hasAttachment !== undefined) {
      conds.push(Prisma.sql`${q.hasAttachment ? Prisma.empty : Prisma.sql`NOT`} EXISTS (SELECT 1 FROM "Attachment" a WHERE a."messageId" = m.id)`);
    }
    const order = tsq ? Prisma.sql`ts_rank(m."searchVector", q.query) DESC, m."createdAt" DESC` : Prisma.sql`m."createdAt" DESC`;
    const rows = await this.prisma.$queryRaw<MessageRow[]>`
      SELECT m.id, m."conversationId", m."parentId", m.type::text AS type, m."createdAt", m."deletedAt",
        c.type::text AS "convType", c.title AS "convTitle", cm."historySince",
        ch.id AS "channelId", ch.name AS "channelName", ch."deletedAt" AS "channelDeletedAt",
        t.name AS "teamName", t."deletedAt" AS "teamDeletedAt",
        u.id AS "authorId", u."displayName" AS "authorName",
        CASE WHEN q.query IS NULL THEN left(m.body, 200)
          ELSE ts_headline('english', m.body, q.query, 'StartSel=«,StopSel=»,MaxWords=30,MinWords=12,MaxFragments=1')
        END AS snippet,
        EXISTS (SELECT 1 FROM "Attachment" a WHERE a."messageId" = m.id) AS "hasAttachment"
      FROM "Message" m
      JOIN "ConversationMember" cm ON cm."conversationId" = m."conversationId" AND cm."userId" = ${me}
      JOIN "Conversation" c ON c.id = m."conversationId"
      LEFT JOIN "Channel" ch ON ch."conversationId" = c.id
      LEFT JOIN "Team" t ON t.id = ch."teamId"
      LEFT JOIN "User" u ON u.id = m."authorId"
      CROSS JOIN (SELECT ${query} AS query) q
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY ${order}
      LIMIT ${q.limit}`;
    const visible = rows.filter((r) =>
      messageVisible({
        message: r,
        membership: { historySince: r.historySince },
        channel: r.channelId ? { deletedAt: r.channelDeletedAt, teamDeletedAt: r.teamDeletedAt } : null,
      }),
    );
    const titles = await this.chatTitles(me, visible.filter((r) => !r.channelId && !r.convTitle).map((r) => r.conversationId));
    return visible.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      kind: r.channelId ? 'channel' : 'chat',
      channelId: r.channelId,
      threadId: r.channelId ? (r.parentId ?? r.id) : null,
      location: r.channelId ? `${r.teamName} › ${r.channelName}` : (r.convTitle ?? titles.get(r.conversationId) ?? 'Chat'),
      author: r.authorId ? { id: r.authorId, displayName: r.authorName ?? '' } : null,
      snippet: stripMentionMarkup(r.snippet),
      hasAttachment: r.hasAttachment,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Untitled chats are named after the other members, as in the chat list. */
  private async chatTitles(me: string, conversationIds: string[]) {
    const ids = [...new Set(conversationIds)];
    if (!ids.length) return new Map<string, string>();
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId: { in: ids }, userId: { not: me } },
      select: { conversationId: true, user: { select: { displayName: true } } },
    });
    const names = new Map<string, string[]>();
    for (const m of members) names.set(m.conversationId, [...(names.get(m.conversationId) ?? []), m.user.displayName]);
    return new Map(ids.map((id) => [id, names.get(id)?.join(', ') || 'Just you']));
  }

  private async fileHits(me: string, term: string, take: number): Promise<FileHit[]> {
    const items = await this.files.search(me, term);
    return items.slice(0, take).map((f) => ({
      id: f.id,
      name: f.name,
      kind: f.kind,
      mimeType: f.mimeType,
      size: f.size,
      modifiedAt: f.modifiedAt,
      location: f.location ?? '',
    }));
  }

  private async teams(me: string, term: string, take: number): Promise<TeamHit[]> {
    const rows = await this.prisma.team.findMany({
      where: {
        deletedAt: null,
        OR: [{ members: { some: { userId: me } } }, { visibility: { in: ['public', 'orgwide'] } }],
        AND: [{ OR: [{ name: { contains: term, mode: 'insensitive' } }, { description: { contains: term, mode: 'insensitive' } }] }],
      },
      include: { members: { where: { userId: me }, select: { userId: true } } },
      orderBy: { name: 'asc' },
      take,
    });
    return rows.map((t) => ({ id: t.id, name: t.name, description: t.description, isMember: t.members.length > 0 }));
  }

  private async channels(me: string, term: string, take: number): Promise<ChannelHit[]> {
    const memberOf = await this.prisma.conversationMember.findMany({ where: { userId: me, conversation: { type: 'channel' } }, select: { conversationId: true } });
    const rows = await this.prisma.channel.findMany({
      where: {
        deletedAt: null,
        team: { deletedAt: null },
        conversationId: { in: memberOf.map((m) => m.conversationId) },
        OR: [{ name: { contains: term, mode: 'insensitive' } }, { description: { contains: term, mode: 'insensitive' } }],
      },
      include: { team: { select: { name: true } } },
      orderBy: { name: 'asc' },
      take,
    });
    return rows.map((c) => ({ id: c.id, name: c.name, teamId: c.teamId, teamName: c.team.name, type: c.type }));
  }

  private async meetings(me: string, term: string, take: number): Promise<MeetingHit[]> {
    const rows = await this.prisma.meeting.findMany({
      where: {
        cancelledAt: null,
        OR: [{ organizerId: me }, { attendees: { some: { userId: me } } }],
        title: { contains: term, mode: 'insensitive' },
      },
      orderBy: { startAt: 'desc' },
      take,
    });
    return rows.map((m) => ({ id: m.id, title: m.title, startAt: m.startAt.toISOString(), endAt: m.endAt.toISOString() }));
  }
}
