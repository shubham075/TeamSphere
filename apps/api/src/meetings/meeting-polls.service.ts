import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CallUser, MeetingActivityEvent, MeetingPollInfo, MeetingPollInput, MeetingQuestionInfo, WS_EVENTS,
} from '@teamsphere/shared';
import { toCallUser } from '../calls/calls.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  initialQuestionStatus, pollResultsVisible, pollVisible, QuestionAction, questionActionAllowed, questionVisible,
  showQuestionAuthor, validBallot,
} from './advanced.logic';
import { MeetingsService } from './meetings.service';

const POLL_INCLUDE = { votes: true } satisfies Prisma.MeetingPollInclude;
type PollRow = Prisma.MeetingPollGetPayload<{ include: typeof POLL_INCLUDE }>;
const QUESTION_INCLUDE = { votes: { select: { userId: true } } } satisfies Prisma.MeetingQuestionInclude;
type QuestionRow = Prisma.MeetingQuestionGetPayload<{ include: typeof QUESTION_INCLUDE }>;

/**
 * Meeting polls (drafts launched live) and moderated Q&A. Separate from chat polls because they need drafts,
 * anonymity and guest voters, who have no chat access.
 */
@Injectable()
export class MeetingPollsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly meetings: MeetingsService,
  ) {}

  // ------------------------------------------------------------------ polls

  async polls(me: string, meetingId: string): Promise<MeetingPollInfo[]> {
    const { moderator } = await this.meetings.access(me, meetingId);
    const rows = await this.prisma.meetingPoll.findMany({ where: { meetingId }, include: POLL_INCLUDE, orderBy: { createdAt: 'asc' } });
    const visible = rows.filter((p) => pollVisible(p.status, moderator));
    const users = moderator ? await this.users(visible.filter((p) => !p.anonymous).flatMap((p) => p.votes.map((v) => v.userId))) : new Map();
    return visible.map((p) => this.toPoll(p, me, moderator, users));
  }

  async createPoll(me: string, meetingId: string, input: Required<Omit<MeetingPollInput, 'launch'>> & { launch: boolean }) {
    await this.requireModerator(me, meetingId);
    const now = new Date();
    const poll = await this.prisma.meetingPoll.create({
      data: {
        meetingId, question: input.question, options: input.options, multiple: input.multiple, anonymous: input.anonymous, createdById: me,
        status: input.launch ? 'live' : 'draft', launchedAt: input.launch ? now : null,
      },
    });
    await this.changed(meetingId, 'polls', input.launch ? poll.id : undefined);
    return this.polls(me, meetingId);
  }

  async pollAction(me: string, pollId: string, action: 'launch' | 'close' | 'delete') {
    const poll = await this.prisma.meetingPoll.findUnique({ where: { id: pollId } });
    if (!poll) throw new NotFoundException('Poll not found');
    await this.requireModerator(me, poll.meetingId);
    if (action === 'delete') await this.prisma.meetingPoll.delete({ where: { id: pollId } });
    if (action === 'launch') {
      if (poll.status !== 'draft') throw new BadRequestException('This poll was already launched');
      await this.prisma.meetingPoll.update({ where: { id: pollId }, data: { status: 'live', launchedAt: new Date() } });
    }
    if (action === 'close') await this.prisma.meetingPoll.update({ where: { id: pollId }, data: { status: 'closed', closedAt: new Date() } });
    await this.changed(poll.meetingId, 'polls', action === 'launch' ? pollId : undefined);
    return this.polls(me, poll.meetingId);
  }

  /** Replaces my ballot. */
  async vote(me: string, pollId: string, options: number[]) {
    const poll = await this.prisma.meetingPoll.findUnique({ where: { id: pollId } });
    if (!poll) throw new NotFoundException('Poll not found');
    await this.meetings.access(me, poll.meetingId);
    const error = validBallot(poll, options);
    if (error) throw new BadRequestException(error);
    await this.prisma.$transaction([
      this.prisma.meetingPollVote.deleteMany({ where: { pollId, userId: me } }),
      this.prisma.meetingPollVote.createMany({ data: [...new Set(options)].map((option) => ({ pollId, userId: me, option })) }),
    ]);
    await this.changed(poll.meetingId, 'polls');
    return this.polls(me, poll.meetingId);
  }

  // ------------------------------------------------------------------ Q&A

  async questions(me: string, meetingId: string): Promise<MeetingQuestionInfo[]> {
    const { m, moderator } = await this.meetings.access(me, meetingId);
    if (!this.meetings.optionsOf(m).allowQna) return [];
    const rows = await this.prisma.meetingQuestion.findMany({ where: { meetingId }, include: QUESTION_INCLUDE, orderBy: { createdAt: 'asc' } });
    const visible = rows.filter((q) => questionVisible(q, me, moderator));
    const users = await this.users(visible.filter((q) => showQuestionAuthor(q, me)).map((q) => q.authorId));
    return visible
      .map((q) => this.toQuestion(q, me, users))
      .sort((a, b) => b.upvotes - a.upvotes || a.createdAt.localeCompare(b.createdAt));
  }

  async ask(me: string, meetingId: string, text: string, anonymous: boolean) {
    const { m, moderator } = await this.meetings.access(me, meetingId);
    const options = this.meetings.optionsOf(m);
    if (!options.allowQna) throw new ForbiddenException('Q&A is turned off for this meeting');
    await this.prisma.meetingQuestion.create({ data: { meetingId, authorId: me, text, anonymous, status: initialQuestionStatus(options.moderateQna, moderator) } });
    await this.changed(meetingId, 'questions');
    return this.questions(me, meetingId);
  }

  async questionAction(me: string, questionId: string, action: QuestionAction) {
    const q = await this.prisma.meetingQuestion.findUnique({ where: { id: questionId } });
    if (!q) throw new NotFoundException('Question not found');
    const { moderator } = await this.meetings.access(me, q.meetingId);
    if (!questionVisible(q, me, moderator) || !questionActionAllowed(action, q, me, moderator)) throw new ForbiddenException('You can’t do that');
    switch (action) {
      case 'publish':
      case 'answer':
      case 'dismiss':
        await this.prisma.meetingQuestion.update({ where: { id: q.id }, data: { status: action === 'publish' ? 'published' : action === 'answer' ? 'answered' : 'dismissed' } });
        break;
      case 'delete':
        await this.prisma.meetingQuestion.delete({ where: { id: q.id } });
        break;
      case 'upvote':
        await this.prisma.meetingQuestionVote.upsert({ where: { questionId_userId: { questionId: q.id, userId: me } }, create: { questionId: q.id, userId: me }, update: {} });
        break;
      case 'unvote':
        await this.prisma.meetingQuestionVote.deleteMany({ where: { questionId: q.id, userId: me } });
        break;
    }
    await this.changed(q.meetingId, 'questions');
    return this.questions(me, q.meetingId);
  }

  // ------------------------------------------------------------------ helpers

  private async requireModerator(me: string, meetingId: string) {
    const access = await this.meetings.access(me, meetingId);
    if (!access.moderator) throw new ForbiddenException('Only organizers and presenters can run polls');
    return access;
  }

  private toPoll(p: PollRow, me: string, moderator: boolean, users: Map<string, CallUser>): MeetingPollInfo {
    const myVotes = p.votes.filter((v) => v.userId === me).map((v) => v.option);
    const show = pollResultsVisible(p.status, moderator, myVotes.length > 0);
    const counts = p.options.map((_, i) => p.votes.filter((v) => v.option === i).length);
    return {
      id: p.id, question: p.question, options: p.options, multiple: p.multiple, anonymous: p.anonymous, status: p.status,
      counts: show ? counts : [], voters: new Set(p.votes.map((v) => v.userId)).size, myVotes,
      votesByOption: moderator && !p.anonymous ? p.options.map((_, i) => p.votes.filter((v) => v.option === i).map((v) => users.get(v.userId)!).filter(Boolean)) : null,
      createdAt: p.createdAt.toISOString(), launchedAt: p.launchedAt?.toISOString() ?? null,
    };
  }

  private toQuestion(q: QuestionRow, me: string, users: Map<string, CallUser>): MeetingQuestionInfo {
    return {
      id: q.id, text: q.text, author: showQuestionAuthor(q, me) ? (users.get(q.authorId) ?? null) : null, mine: q.authorId === me,
      status: q.status, upvotes: q.votes.length, upvotedByMe: q.votes.some((v) => v.userId === me), createdAt: q.createdAt.toISOString(),
    };
  }

  private async users(ids: string[]): Promise<Map<string, CallUser>> {
    const rows = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, displayName: true, avatarKey: true } });
    return new Map(rows.map((u) => [u.id, toCallUser(u)]));
  }

  /** Everyone who can see the meeting refetches; a launched poll pops up for everyone in it. */
  private async changed(meetingId: string, kind: MeetingActivityEvent['kind'], launchedPollId?: string) {
    const m = await this.prisma.meeting.findUnique({ where: { id: meetingId }, include: { attendees: { select: { userId: true } } } });
    if (!m) return;
    const event: MeetingActivityEvent = { meetingId, kind, ...(launchedPollId ? { launchedPollId } : {}) };
    this.realtime.toUsers(new Set([m.organizerId, ...m.attendees.map((a) => a.userId), ...this.meetings.liveAudience(meetingId)]), WS_EVENTS.meetingActivity, event);
  }
}
