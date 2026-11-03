import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  CollabMembersInput, collabMembersSchema, CreateBoardInput, createBoardSchema, CreatePageInput, createPageSchema, UpdateBoardInput,
  updateBoardSchema, UpdatePageInput, updatePageSchema,
} from '@teamsphere/shared';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { BoardsService } from './boards.service';
import { PagesService } from './pages.service';

const ctx = (req: Request) => ({ ip: req.ip ?? null });

@Controller('pages')
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @Get()
  home(@CurrentUser() me: AuthUser) {
    return this.pages.home(me.id);
  }

  @Get('channel/:channelId')
  channel(@CurrentUser() me: AuthUser, @Param('channelId') channelId: string) {
    return this.pages.channelPages(me.id, channelId);
  }

  @Get('meeting/:meetingId')
  meeting(@CurrentUser() me: AuthUser, @Param('meetingId') meetingId: string) {
    return this.pages.meetingNotes(me.id, meetingId);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Req() req: Request, @Body(new ZodPipe(createPageSchema)) body: CreatePageInput) {
    return this.pages.create(me.id, body, ctx(req));
  }

  @Get(':id')
  get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.pages.get(me.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updatePageSchema)) body: UpdatePageInput) {
    return this.pages.update(me.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string) {
    return this.pages.remove(me.id, id, ctx(req));
  }

  @Post(':id/members')
  addMembers(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(collabMembersSchema)) body: CollabMembersInput) {
    return this.pages.addMembers(me.id, id, body.userIds);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('userId') userId: string) {
    return this.pages.removeMember(me.id, id, userId);
  }
}

@Controller('whiteboards')
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Get()
  list(@CurrentUser() me: AuthUser) {
    return this.boards.list(me.id);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Req() req: Request, @Body(new ZodPipe(createBoardSchema)) body: CreateBoardInput) {
    return this.boards.create(me.id, body, ctx(req));
  }

  @Get(':id')
  get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.boards.get(me.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateBoardSchema)) body: UpdateBoardInput) {
    return this.boards.update(me.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string) {
    return this.boards.remove(me.id, id, ctx(req));
  }

  @Post(':id/members')
  addMembers(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(collabMembersSchema)) body: CollabMembersInput) {
    return this.boards.addMembers(me.id, id, body.userIds);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('userId') userId: string) {
    return this.boards.removeMember(me.id, id, userId);
  }
}
