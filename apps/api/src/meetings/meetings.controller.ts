import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, NotFoundException, Param, Patch, Post, Put,
  Query, Req, Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  BreakoutActionInput, breakoutActionSchema, createMeetingSchema, guestJoinSchema, handSchema, hostActionSchema, HostActionInput,
  instantMeetingSchema, joinMeetingSchema, lobbyDecisionSchema, meetingPollActionSchema, meetingPollSchema, meetingPollVoteSchema,
  meetingQuestionActionSchema, meetingQuestionSchema, recordingActionSchema, rsvpSchema, updateMeetingOptionsSchema, updateMeetingSchema,
  WorkingHours, workingHoursSchema,
} from '@teamsphere/shared';
import { AuthUser, CurrentUser, GuestAllowed, Public } from '../common/auth.decorators';
import { clientInfo } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { guestMeetingAllowed } from './advanced.logic';
import { MeetingPollsService } from './meeting-polls.service';
import { MeetingsService } from './meetings.service';
import { RecordingsService } from './recordings.service';

const date = (v: string | undefined, name: string) => {
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid ${name}`);
  return d;
};

@Controller('meetings')
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly polls: MeetingPollsService,
    private readonly recordings: RecordingsService,
  ) {}

  // ---- guests (anonymous join from the link)

  /** Name only → a guest session scoped to this one meeting. Tightly rate-limited per IP. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('guest-join')
  guestJoin(@Body(new ZodPipe(guestJoinSchema)) body: z.output<typeof guestJoinSchema>, @Req() req: Request) {
    return this.meetings.guestJoin(body.code, body.name, clientInfo(req));
  }

  /** Signed playback URL (from the recordings list), so <video> works without an auth header. Supports Range. */
  @Public()
  @Get('recordings/:id/content')
  async recordingContent(
    @Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Headers('range') range: string | undefined, @Res() res: Response,
  ) {
    if (!this.recordings.verifyUrl(id, exp, sig)) throw new ForbiddenException('This link has expired');
    const rec = await this.recordings.content(id);
    if (!rec) throw new NotFoundException();
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `inline; filename="recording-${rec.startedAt.toISOString().slice(0, 10)}.mp4"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      const part = await this.recordings.range(rec.storageKey, range);
      res.status(206);
      if (part.contentRange) res.setHeader('Content-Range', part.contentRange);
      if (part.size !== undefined) res.setHeader('Content-Length', String(part.size));
      part.body.pipe(res);
      return;
    }
    const whole = await this.recordings.object(rec.storageKey);
    if (whole.size !== undefined) res.setHeader('Content-Length', String(whole.size));
    whole.body.pipe(res);
  }

  // Static routes come before `:id`.

  /** Expanded occurrences for the calendar views. */
  @Get('calendar')
  calendar(@CurrentUser() me: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.meetings.calendar(me.id, date(from, 'from'), date(to, 'to'));
  }

  @Get('free-busy')
  freeBusy(
    @CurrentUser() me: AuthUser,
    @Query('userIds') userIds = '',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('duration') duration = '30',
    @Query('tz') tz = 'UTC',
    @Query('exclude') exclude?: string,
  ) {
    const durationMin = Math.min(Math.max(Number(duration) || 30, 5), 24 * 60);
    return this.meetings.freeBusy(me.id, { userIds: userIds.split(',').filter(Boolean), from: date(from, 'from'), to: date(to, 'to'), durationMin, timeZone: tz, excludeMeetingId: exclude });
  }

  @Get('working-hours')
  workingHours(@CurrentUser() me: AuthUser, @Query('tz') tz?: string) {
    return this.meetings.workingHours(me.id, tz);
  }

  @Put('working-hours')
  setWorkingHours(@CurrentUser() me: AuthUser, @Body(new ZodPipe(workingHoursSchema)) body: WorkingHours) {
    return this.meetings.setWorkingHours(me.id, body);
  }

  @Get('live')
  live(@CurrentUser() me: AuthUser, @Query('conversationId') conversationId?: string, @Query('channelId') channelId?: string) {
    return this.meetings.liveFor(me.id, { conversationId, channelId });
  }

  @Get('code/:code')
  byCode(@CurrentUser() me: AuthUser, @Param('code') code: string) {
    return this.meetings.byJoinCode(me.id, code);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Body(new ZodPipe(createMeetingSchema)) body: z.output<typeof createMeetingSchema>) {
    return this.meetings.create(me.id, body);
  }

  @Post('instant')
  instant(@CurrentUser() me: AuthUser, @Body(new ZodPipe(instantMeetingSchema)) body: z.output<typeof instantMeetingSchema>) {
    return this.meetings.instant(me.id, body);
  }

  // ---- live sessions

  @GuestAllowed()
  @Get('sessions/:sessionId')
  state(@CurrentUser() me: AuthUser, @Param('sessionId') sessionId: string) {
    return this.meetings.liveState(me.id, sessionId);
  }

  @GuestAllowed()
  @Post('sessions/:sessionId/leave')
  @HttpCode(204)
  leave(@CurrentUser() me: AuthUser, @Param('sessionId') sessionId: string) {
    return this.meetings.leave(me.id, sessionId);
  }

  @Post('sessions/:sessionId/lobby')
  lobby(@CurrentUser() me: AuthUser, @Param('sessionId') sessionId: string, @Body(new ZodPipe(lobbyDecisionSchema)) body: z.output<typeof lobbyDecisionSchema>) {
    return this.meetings.lobbyDecision(me.id, sessionId, body.userIds, body.admit);
  }

  @Post('sessions/:sessionId/host')
  host(@CurrentUser() me: AuthUser, @Param('sessionId') sessionId: string, @Body(new ZodPipe(hostActionSchema)) body: HostActionInput) {
    return this.meetings.hostAction(me.id, sessionId, body);
  }

  @GuestAllowed()
  @Post('sessions/:sessionId/hand')
  hand(@CurrentUser() me: AuthUser, @Param('sessionId') sessionId: string, @Body(new ZodPipe(handSchema)) body: z.output<typeof handSchema>) {
    return this.meetings.hand(me.id, sessionId, body.raised);
  }

  @GuestAllowed()
  @Get('sessions/:sessionId/token')
  token(@CurrentUser() me: AuthUser, @Param('sessionId') sessionId: string, @Query('room') room?: string) {
    return this.meetings.roomToken(me.id, sessionId, room);
  }

  @Post('sessions/:sessionId/breakouts')
  breakouts(@CurrentUser() me: AuthUser, @Param('sessionId') sessionId: string, @Body(new ZodPipe(breakoutActionSchema)) body: BreakoutActionInput) {
    return this.meetings.breakoutAction(me.id, sessionId, body);
  }

  @Post('sessions/:sessionId/recording')
  recording(@CurrentUser() me: AuthUser, @Param('sessionId') sessionId: string, @Body(new ZodPipe(recordingActionSchema)) body: z.output<typeof recordingActionSchema>) {
    return this.meetings.setRecording(me.id, sessionId, body.recording);
  }

  // ---- polls & Q&A

  @GuestAllowed()
  @Post('polls/:pollId/vote')
  vote(@CurrentUser() me: AuthUser, @Param('pollId') pollId: string, @Body(new ZodPipe(meetingPollVoteSchema)) body: z.output<typeof meetingPollVoteSchema>) {
    return this.polls.vote(me.id, pollId, body.options);
  }

  @Post('polls/:pollId')
  pollAction(@CurrentUser() me: AuthUser, @Param('pollId') pollId: string, @Body(new ZodPipe(meetingPollActionSchema)) body: z.output<typeof meetingPollActionSchema>) {
    return this.polls.pollAction(me.id, pollId, body.action);
  }

  @GuestAllowed()
  @Post('questions/:questionId')
  questionAction(@CurrentUser() me: AuthUser, @Param('questionId') questionId: string, @Body(new ZodPipe(meetingQuestionActionSchema)) body: z.output<typeof meetingQuestionActionSchema>) {
    return this.polls.questionAction(me.id, questionId, body.action);
  }

  // ---- one meeting

  @GuestAllowed()
  @Get(':id')
  get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    guestScope(me, id);
    return this.meetings.get(me.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateMeetingSchema)) body: z.output<typeof updateMeetingSchema>) {
    return this.meetings.update(me.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  cancel(@CurrentUser() me: AuthUser, @Param('id') id: string, @Query('occurrence') occurrence?: string) {
    return this.meetings.cancel(me.id, id, occurrence ? date(occurrence, 'occurrence').toISOString() : undefined);
  }

  @Post(':id/rsvp')
  rsvp(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(rsvpSchema)) body: z.output<typeof rsvpSchema>) {
    return this.meetings.rsvp(me.id, id, body);
  }

  @Put(':id/options')
  options(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateMeetingOptionsSchema)) body: z.output<typeof updateMeetingOptionsSchema>) {
    return this.meetings.updateOptions(me.id, id, body);
  }

  @GuestAllowed()
  @Post(':id/join')
  join(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(joinMeetingSchema)) body: z.output<typeof joinMeetingSchema>) {
    guestScope(me, id);
    return this.meetings.join(me.id, id, body.occurrence);
  }

  @Get(':id/recordings')
  listRecordings(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.meetings.listRecordings(me.id, id);
  }

  @GuestAllowed()
  @Get(':id/polls')
  listPolls(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    guestScope(me, id);
    return this.polls.polls(me.id, id);
  }

  @Post(':id/polls')
  createPoll(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(meetingPollSchema)) body: z.output<typeof meetingPollSchema>) {
    return this.polls.createPoll(me.id, id, body);
  }

  @GuestAllowed()
  @Get(':id/questions')
  listQuestions(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    guestScope(me, id);
    return this.polls.questions(me.id, id);
  }

  @GuestAllowed()
  @Post(':id/questions')
  ask(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(meetingQuestionSchema)) body: z.output<typeof meetingQuestionSchema>) {
    guestScope(me, id);
    return this.polls.ask(me.id, id, body.text, body.anonymous);
  }

  @Get(':id/attendance')
  attendance(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.meetings.attendance(me.id, id);
  }
}

/** Guest tokens only work for their own meeting (belt and braces: the services check membership too). */
function guestScope(me: AuthUser, meetingId: string) {
  if (!guestMeetingAllowed(me, meetingId)) throw new ForbiddenException('Guests can only use the meeting they joined');
}
