import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query,
  Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { diskStorage } from 'multer';
import {
  checklistItemSchema, CreateBucketInput, createBucketSchema, CreateChannelTabInput, createChannelTabSchema, CreatePlanInput,
  createPlanSchema, CreateTaskInput, createTaskSchema, dateOnlySchema, MAX_TASK_ATTACHMENT_BYTES, MyDayInput, myDaySchema,
  PlanMembersInput, planMembersSchema, taskCommentSchema, TODO_LISTS, TodoList, UpdateBucketInput, updateBucketSchema,
  UpdateChecklistItemInput, updateChecklistItemSchema, UpdatePlanInput, updatePlanSchema, UpdateTaskInput, updateTaskSchema,
} from '@teamsphere/shared';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { StorageService } from '../infra/storage';
import { ChannelTabsService } from './channel-tabs.service';
import { PlannerService } from './planner.service';

const upload = FileInterceptor('file', { storage: diskStorage({ destination: tmpdir() }), limits: { fileSize: MAX_TASK_ATTACHMENT_BYTES, files: 1 } });
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|bmp)|video\/(mp4|webm|ogg)|audio\/|application\/pdf$|text\/plain$)/;

const ctx = (req: Request) => ({ ip: req.ip ?? null });

/** `?day=YYYY-MM-DD`: the caller's local date, for My Day flags. */
function day(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!dateOnlySchema.safeParse(value).success) throw new BadRequestException('Invalid day');
  return value;
}

@Controller('planner')
export class PlannerController {
  constructor(
    private readonly planner: PlannerService,
    private readonly storage: StorageService,
  ) {}

  @Get('plans')
  plans(@CurrentUser() me: AuthUser) {
    return this.planner.listPlans(me.id);
  }

  @Post('plans')
  createPlan(@CurrentUser() me: AuthUser, @Req() req: Request, @Body(new ZodPipe(createPlanSchema)) body: CreatePlanInput) {
    return this.planner.createPlan(me.id, body, ctx(req));
  }

  @Get('plans/:id')
  plan(@CurrentUser() me: AuthUser, @Param('id') id: string, @Query('day') d?: string) {
    return this.planner.getPlan(me.id, id, day(d));
  }

  @Patch('plans/:id')
  updatePlan(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updatePlanSchema)) body: UpdatePlanInput) {
    return this.planner.updatePlan(me.id, id, body);
  }

  @Delete('plans/:id')
  @HttpCode(204)
  deletePlan(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string) {
    return this.planner.deletePlan(me.id, id, ctx(req));
  }

  @Post('plans/:id/members')
  addMembers(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(planMembersSchema)) body: PlanMembersInput) {
    return this.planner.addMembers(me.id, id, body.userIds);
  }

  @Delete('plans/:id/members/:userId')
  @HttpCode(204)
  removeMember(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('userId') userId: string) {
    return this.planner.removeMember(me.id, id, userId);
  }

  @Post('plans/:id/buckets')
  createBucket(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(createBucketSchema)) body: CreateBucketInput) {
    return this.planner.createBucket(me.id, id, body);
  }

  @Patch('buckets/:id')
  updateBucket(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateBucketSchema)) body: UpdateBucketInput) {
    return this.planner.updateBucket(me.id, id, body);
  }

  @Delete('buckets/:id')
  @HttpCode(204)
  deleteBucket(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.planner.deleteBucket(me.id, id);
  }

  @Get('todo')
  todo(@CurrentUser() me: AuthUser, @Query('list') list = 'tasks', @Query('day') d?: string) {
    if (!(TODO_LISTS as readonly string[]).includes(list)) throw new BadRequestException('Unknown list');
    return this.planner.todo(me.id, list as TodoList, day(d));
  }

  @Post('tasks')
  createTask(@CurrentUser() me: AuthUser, @Req() req: Request, @Body(new ZodPipe(createTaskSchema)) body: CreateTaskInput) {
    return this.planner.createTask(me.id, body, ctx(req));
  }

  @Get('tasks/:id')
  task(@CurrentUser() me: AuthUser, @Param('id') id: string, @Query('day') d?: string) {
    return this.planner.taskDetail(me.id, id, day(d));
  }

  @Patch('tasks/:id')
  updateTask(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateTaskSchema)) body: UpdateTaskInput, @Query('day') d?: string) {
    return this.planner.updateTask(me.id, id, body, day(d));
  }

  @Delete('tasks/:id')
  @HttpCode(204)
  deleteTask(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string) {
    return this.planner.deleteTask(me.id, id, ctx(req));
  }

  @Put('tasks/:id/my-day')
  @HttpCode(204)
  myDay(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(myDaySchema)) body: MyDayInput) {
    return this.planner.setMyDay(me.id, id, body);
  }

  @Post('tasks/:id/checklist')
  addChecklistItem(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(checklistItemSchema)) body: { text: string }) {
    return this.planner.addChecklistItem(me.id, id, body.text);
  }

  @Patch('checklist/:id')
  updateChecklistItem(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateChecklistItemSchema)) body: UpdateChecklistItemInput) {
    return this.planner.updateChecklistItem(me.id, id, body);
  }

  @Delete('checklist/:id')
  @HttpCode(204)
  deleteChecklistItem(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.planner.deleteChecklistItem(me.id, id);
  }

  @Post('tasks/:id/comments')
  addComment(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(taskCommentSchema)) body: { body: string }) {
    return this.planner.addComment(me.id, id, body.body);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  deleteComment(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.planner.deleteComment(me.id, id);
  }

  @Post('tasks/:id/attachments')
  @UseInterceptors(upload)
  async addAttachment(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    try {
      // Browsers send multipart filenames as latin1.
      const name = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 255) || 'file';
      const mimeType = file.mimetype || 'application/octet-stream';
      return await this.planner.addAttachment(me.id, id, {
        name,
        mimeType,
        size: file.size,
        store: (key) => this.storage.put(key, createReadStream(file.path), mimeType, file.size),
      }, ctx(req));
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }

  @Delete('attachments/:id')
  @HttpCode(204)
  deleteAttachment(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.planner.deleteAttachment(me.id, id);
  }

  /** Signed URL (no auth header) so <img> and downloads work, like file versions. */
  @Public()
  @Get('attachments/:id/content')
  async content(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Query('download') download: string | undefined, @Res() res: Response) {
    if (!this.storage.verify(`ta:${id}`, exp, sig)) throw new ForbiddenException('This link has expired');
    const row = await this.planner.attachment(id);
    if (!row) throw new NotFoundException();
    const inline = !download && INLINE_TYPES.test(row.mimeType);
    res.setHeader('Content-Type', inline ? row.mimeType : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.fileName)}`);
    res.setHeader('Content-Length', String(row.size));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
    const object = await this.storage.get(row.storageKey);
    object.body.pipe(res);
  }
}

@Controller('channels/:channelId/tabs')
export class ChannelTabsController {
  constructor(private readonly tabs: ChannelTabsService) {}

  @Get()
  list(@CurrentUser() me: AuthUser, @Param('channelId') channelId: string) {
    return this.tabs.list(me.id, channelId);
  }

  @Post()
  add(@CurrentUser() me: AuthUser, @Param('channelId') channelId: string, @Body(new ZodPipe(createChannelTabSchema)) body: CreateChannelTabInput) {
    return this.tabs.add(me.id, channelId, body);
  }

  @Delete(':tabId')
  @HttpCode(204)
  remove(@CurrentUser() me: AuthUser, @Param('channelId') channelId: string, @Param('tabId') tabId: string) {
    return this.tabs.remove(me.id, channelId, tabId);
  }
}
