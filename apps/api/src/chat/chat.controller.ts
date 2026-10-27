import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch,
  Post, Put, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { diskStorage } from 'multer';
import { z } from 'zod';
import {
  AddMembersInput, addMembersSchema, CreateConversationInput, createConversationSchema, EditMessageInput,
  editMessageSchema, MAX_ATTACHMENT_BYTES, MemberSettingsInput, memberSettingsSchema, sendMessageSchema,
  UpdateConversationInput, updateConversationSchema,
} from '@teamsphere/shared';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../infra/storage';
import { ChatService } from './chat.service';

type SendBody = z.output<typeof sendMessageSchema>;

@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly chat: ChatService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  list(@CurrentUser() me: AuthUser) {
    return this.chat.list(me.id);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Body(new ZodPipe(createConversationSchema)) body: CreateConversationInput) {
    return this.chat.create(me.id, body);
  }

  @Get(':id')
  get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.chat.get(me.id, id);
  }

  @Patch(':id')
  rename(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateConversationSchema)) body: UpdateConversationInput) {
    return this.chat.rename(me.id, id, body.title);
  }

  @Post(':id/members')
  addMembers(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(addMembersSchema)) body: AddMembersInput) {
    return this.chat.addMembers(me.id, id, body);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('userId') userId: string) {
    return this.chat.removeMember(me.id, id, userId);
  }

  @Patch(':id/me')
  settings(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(memberSettingsSchema)) body: MemberSettingsInput) {
    return this.chat.updateMySettings(me.id, id, body);
  }

  @Post(':id/read')
  read(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.chat.markRead(me.id, id);
  }

  @Get(':id/messages')
  messages(@CurrentUser() me: AuthUser, @Param('id') id: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    return this.chat.messages(me.id, id, before || undefined, Number(limit) || 50);
  }

  @Post(':id/messages')
  send(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(sendMessageSchema)) body: SendBody) {
    return this.chat.send(me.id, id, body);
  }

  @Post(':id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({ destination: tmpdir() }),
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
    }),
  )
  async upload(@CurrentUser() me: AuthUser, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    try {
      // Browsers send multipart filenames as latin1; recover UTF-8 names (e.g. "Résumé.pdf").
      const originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      return await this.chat.addAttachment(me.id, id, { ...file, originalname }, (key) =>
        this.storage.put(key, createReadStream(file.path), file.mimetype, file.size),
      );
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }
}

@Controller('messages')
export class MessagesController {
  constructor(private readonly chat: ChatService) {}

  @Patch(':id')
  edit(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(editMessageSchema)) body: EditMessageInput) {
    return this.chat.edit(me.id, id, body.body);
  }

  @Delete(':id')
  remove(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.chat.remove(me.id, id);
  }

  @Put(':id/reactions/:emoji')
  react(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('emoji') emoji: string) {
    return this.chat.react(me.id, id, emoji, true);
  }

  @Delete(':id/reactions/:emoji')
  unreact(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('emoji') emoji: string) {
    return this.chat.react(me.id, id, emoji, false);
  }
}

const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|bmp)|video\/(mp4|webm)|audio\/|application\/pdf$)/;

@Controller('attachments')
export class AttachmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Signed-URL download (see StorageService.sign); works in <img>/<video> tags without an auth header. */
  @Public()
  @Get(':id/content')
  async content(
    @Param('id') id: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    if (!this.storage.verify(id, exp, sig)) throw new ForbiddenException('This link has expired');
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException();
    const object = await this.storage.get(attachment.storageKey);
    const inline = !download && INLINE_TYPES.test(attachment.mimeType);
    res.setHeader('Content-Type', inline ? attachment.mimeType : 'application/octet-stream');
    res.setHeader('Content-Length', String(attachment.size));
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
    );
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
    object.body.pipe(res);
  }
}

@Controller('activity')
export class ActivityController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(@CurrentUser() me: AuthUser, @Query('take') take?: string) {
    return this.chat.activity(me.id, Number(take) || 50);
  }

  @Post('read')
  @HttpCode(204)
  read(@CurrentUser() me: AuthUser, @Body(new ZodPipe(z.object({ ids: z.array(z.string()).max(200).optional() }))) body: { ids?: string[] }) {
    return this.chat.markActivityRead(me.id, body.ids);
  }
}
