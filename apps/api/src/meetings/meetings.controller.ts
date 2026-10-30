import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  createMeetingSchema, handSchema, hostActionSchema, HostActionInput, instantMeetingSchema, joinMeetingSchema,
  lobbyDecisionSchema, rsvpSchema, updateMeetingOptionsSchema, updateMeetingSchema, WorkingHours, workingHoursSchema,
} from '@teamsphere/shared';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { MeetingsService } from './meetings.service';

const date = (v: string | undefined, name: string) => {
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid ${name}`);
  return d;
};

@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

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

  @Get('sessions/:sessionId')
  state(@CurrentUser() me: AuthUser, @Param('sessionId') sessionId: string) {
    return this.meetings.liveState(me.id, sessionId);
  }

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

  @Post('sessions/:sessionId/hand')
  hand(@CurrentUser() me: AuthUser, @Param('sessionId') sessionId: string, @Body(new ZodPipe(handSchema)) body: z.output<typeof handSchema>) {
    return this.meetings.hand(me.id, sessionId, body.raised);
  }

  // ---- one meeting

  @Get(':id')
  get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
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

  @Post(':id/join')
  join(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(joinMeetingSchema)) body: z.output<typeof joinMeetingSchema>) {
    return this.meetings.join(me.id, id, body.occurrence);
  }

  @Get(':id/attendance')
  attendance(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.meetings.attendance(me.id, id);
  }
}
