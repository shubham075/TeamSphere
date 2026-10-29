import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  addTeamMembersSchema, channelMembersSchema, channelShareSchema, createChannelSchema, createPostSchema, createReplySchema,
  createTagSchema, createTeamSchema, joinCodeSchema, myChannelSettingsSchema, myTeamSettingsSchema, saveNotesSchema,
  teamOrderSchema, updateChannelSchema, updateTagSchema, updateTeamMemberSchema, updateTeamSchema,
} from '@teamsphere/shared';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ChannelPostsService } from './channel-posts.service';
import { TeamsService } from './teams.service';

type Out<T extends z.ZodType> = z.output<T>;

@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  list(@CurrentUser() me: AuthUser) {
    return this.teams.list(me.id);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Body(new ZodPipe(createTeamSchema)) body: Out<typeof createTeamSchema>) {
    return this.teams.create(me, body);
  }

  @Get('discover')
  discover(@CurrentUser() me: AuthUser, @Query('q') q?: string) {
    return this.teams.discover(me.id, q);
  }

  @Get('deleted')
  deleted(@CurrentUser() me: AuthUser) {
    return this.teams.deletedTeams(me.id);
  }

  @Post('join-code')
  joinByCode(@CurrentUser() me: AuthUser, @Body(new ZodPipe(joinCodeSchema)) body: Out<typeof joinCodeSchema>) {
    return this.teams.joinByCode(me.id, body.code);
  }

  @Put('order')
  @HttpCode(204)
  reorder(@CurrentUser() me: AuthUser, @Body(new ZodPipe(teamOrderSchema)) body: Out<typeof teamOrderSchema>) {
    return this.teams.reorder(me.id, body.teamIds);
  }

  @Get(':id')
  get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.get(me.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateTeamSchema)) body: Out<typeof updateTeamSchema>) {
    return this.teams.update(me.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.remove(me, id);
  }

  @Post(':id/restore')
  restore(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.restore(me, id);
  }

  @Post(':id/archive')
  archive(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.setArchived(me.id, id, true);
  }

  @Post(':id/unarchive')
  unarchive(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.setArchived(me.id, id, false);
  }

  @Post(':id/join')
  join(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.join(me.id, id);
  }

  @Put(':id/join-code')
  resetJoinCode(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.setJoinCode(me.id, id, true);
  }

  @Delete(':id/join-code')
  removeJoinCode(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.setJoinCode(me.id, id, false);
  }

  @Patch(':id/me')
  mySettings(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(myTeamSettingsSchema)) body: Out<typeof myTeamSettingsSchema>) {
    return this.teams.setHidden(me.id, id, !!body.hidden);
  }

  @Get(':id/members')
  members(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.members(me.id, id);
  }

  @Post(':id/members')
  addMembers(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(addTeamMembersSchema)) body: Out<typeof addTeamMembersSchema>) {
    return this.teams.addMembers(me.id, id, body.userIds, body.role);
  }

  @Patch(':id/members/:userId')
  setRole(
    @CurrentUser() me: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body(new ZodPipe(updateTeamMemberSchema)) body: Out<typeof updateTeamMemberSchema>,
  ) {
    return this.teams.setMemberRole(me.id, id, userId, body.role);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('userId') userId: string) {
    return this.teams.removeMember(me.id, id, userId);
  }

  @Get(':id/channels')
  channels(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.teamChannels(me.id, id);
  }

  @Post(':id/channels')
  createChannel(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(createChannelSchema)) body: Out<typeof createChannelSchema>) {
    return this.teams.createChannel(me.id, id, body);
  }

  @Get(':id/channels/deleted')
  deletedChannels(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.deletedChannels(me.id, id);
  }

  @Get(':id/tags')
  tags(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.tags(me.id, id);
  }

  @Post(':id/tags')
  createTag(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(createTagSchema)) body: Out<typeof createTagSchema>) {
    return this.teams.createTag(me.id, id, body.name, body.userIds);
  }
}

@Controller('tags')
export class TagsController {
  constructor(private readonly teams: TeamsService) {}

  @Patch(':id')
  update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateTagSchema)) body: Out<typeof updateTagSchema>) {
    return this.teams.updateTag(me.id, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.deleteTag(me.id, id);
  }
}

@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly teams: TeamsService,
    private readonly posts: ChannelPostsService,
  ) {}

  @Get(':id')
  get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.channelInfoFor(me.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateChannelSchema)) body: Out<typeof updateChannelSchema>) {
    return this.teams.updateChannel(me.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.deleteChannel(me.id, id);
  }

  @Post(':id/restore')
  restore(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.restoreChannel(me.id, id);
  }

  @Post(':id/archive')
  archive(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.setChannelArchived(me.id, id, true);
  }

  @Post(':id/unarchive')
  unarchive(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.setChannelArchived(me.id, id, false);
  }

  @Patch(':id/me')
  mySettings(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(myChannelSettingsSchema)) body: Out<typeof myChannelSettingsSchema>) {
    return this.teams.setMyChannelSettings(me.id, id, body);
  }

  @Post(':id/read')
  read(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.markRead(me.id, id);
  }

  @Get(':id/members')
  members(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.channelMembers(me.id, id);
  }

  @Post(':id/members')
  addMembers(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(channelMembersSchema)) body: Out<typeof channelMembersSchema>) {
    return this.teams.addChannelMembers(me.id, id, body.userIds, body.role);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('userId') userId: string) {
    return this.teams.removeChannelMember(me.id, id, userId);
  }

  @Get(':id/shares')
  shares(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.teams.channelShares(me.id, id);
  }

  @Post(':id/shares')
  share(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(channelShareSchema)) body: Out<typeof channelShareSchema>) {
    return this.teams.shareChannel(me.id, id, body.teamId, true);
  }

  @Delete(':id/shares/:teamId')
  unshare(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('teamId') teamId: string) {
    return this.teams.shareChannel(me.id, id, teamId, false);
  }

  @Get(':id/posts')
  list(@CurrentUser() me: AuthUser, @Param('id') id: string, @Query('before') before?: string) {
    return this.posts.posts(me.id, id, before || undefined);
  }

  @Post(':id/posts')
  post(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(createPostSchema)) body: Out<typeof createPostSchema>) {
    return this.posts.post(me.id, id, body);
  }

  @Post(':id/posts/:rootId/replies')
  reply(
    @CurrentUser() me: AuthUser,
    @Param('id') id: string,
    @Param('rootId') rootId: string,
    @Body(new ZodPipe(createReplySchema)) body: Out<typeof createReplySchema>,
  ) {
    return this.posts.reply(me.id, id, rootId, body);
  }

  @Delete(':id/messages/:messageId')
  deleteMessage(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('messageId') messageId: string) {
    return this.posts.moderatorDelete(me.id, id, messageId);
  }

  @Get(':id/files')
  files(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.posts.files(me.id, id);
  }

  @Get(':id/notes')
  notes(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.posts.notes(me.id, id);
  }

  @Put(':id/notes')
  saveNotes(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(saveNotesSchema)) body: Out<typeof saveNotesSchema>) {
    return this.posts.saveNotes(me.id, id, body.notes, body.version);
  }
}
