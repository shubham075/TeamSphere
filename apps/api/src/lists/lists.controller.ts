import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CollabMembersInput, collabMembersSchema, CreateFormInput, createFormSchema, CreateListInput, createListSchema, ListItemInput,
  listItemSchema, SubmitFormInput, submitFormSchema, UpdateFormInput, updateFormSchema, UpdateListInput, updateListSchema,
} from '@teamsphere/shared';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { FormsService } from './forms.service';
import { ListsService } from './lists.service';

const ctx = (req: Request) => ({ ip: req.ip ?? null });

/** CSV download with a BOM so Excel opens UTF-8 correctly. */
function sendCsv(res: Response, title: string, csv: string) {
  const name = `${title.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'export'}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send('﻿' + csv);
}

@Controller('lists')
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Get()
  list(@CurrentUser() me: AuthUser) {
    return this.lists.list(me.id);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Req() req: Request, @Body(new ZodPipe(createListSchema)) body: CreateListInput) {
    return this.lists.create(me.id, body, ctx(req));
  }

  @Get(':id')
  get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.lists.get(me.id, id);
  }

  @Get(':id/export')
  async export(@CurrentUser() me: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { title, csv } = await this.lists.csv(me.id, id);
    sendCsv(res, title, csv);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateListSchema)) body: UpdateListInput) {
    return this.lists.update(me.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string) {
    return this.lists.remove(me.id, id, ctx(req));
  }

  @Post(':id/items')
  addItem(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(listItemSchema)) body: ListItemInput) {
    return this.lists.addItem(me.id, id, body);
  }

  @Patch('items/:itemId')
  updateItem(@CurrentUser() me: AuthUser, @Param('itemId') itemId: string, @Body(new ZodPipe(listItemSchema)) body: ListItemInput) {
    return this.lists.updateItem(me.id, itemId, body);
  }

  @Delete('items/:itemId')
  @HttpCode(204)
  removeItem(@CurrentUser() me: AuthUser, @Param('itemId') itemId: string) {
    return this.lists.removeItem(me.id, itemId);
  }

  @Post(':id/members')
  addMembers(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(collabMembersSchema)) body: CollabMembersInput) {
    return this.lists.addMembers(me.id, id, body.userIds);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('userId') userId: string) {
    return this.lists.removeMember(me.id, id, userId);
  }
}

@Controller('forms')
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  list(@CurrentUser() me: AuthUser) {
    return this.forms.list(me.id);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Req() req: Request, @Body(new ZodPipe(createFormSchema)) body: CreateFormInput) {
    return this.forms.create(me.id, body, ctx(req));
  }

  @Get(':id')
  get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.forms.get(me.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string, @Body(new ZodPipe(updateFormSchema)) body: UpdateFormInput) {
    return this.forms.update(me.id, id, body, ctx(req));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string) {
    return this.forms.remove(me.id, id, ctx(req));
  }

  @Post(':id/responses')
  @HttpCode(204)
  submit(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(submitFormSchema)) body: SubmitFormInput) {
    return this.forms.submit(me.id, id, body.answers);
  }

  @Get(':id/results')
  results(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.forms.results(me.id, id);
  }

  @Get(':id/export')
  async export(@CurrentUser() me: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { title, csv } = await this.forms.csv(me.id, id);
    sendCsv(res, title, csv);
  }

  @Post(':id/members')
  addMembers(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(collabMembersSchema)) body: CollabMembersInput) {
    return this.forms.addMembers(me.id, id, body.userIds);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('userId') userId: string) {
    return this.forms.removeMember(me.id, id, userId);
  }
}
