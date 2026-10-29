import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, NotFoundException, Param,
  Post, Put, Query, Req, Res, UnauthorizedException, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { diskStorage } from 'multer';
import { z } from 'zod';
import {
  CallSettingsInput, callSettingsSchema, HoldCallInput, holdCallSchema, InviteToCallInput, inviteToCallSchema,
  MAX_VOICEMAIL_BYTES, startCallSchema, TransferCallInput, transferCallSchema,
} from '@teamsphere/shared';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { StorageService } from '../infra/storage';
import { PrismaService } from '../prisma/prisma.service';
import { CallsService } from './calls.service';
import { LivekitService } from './livekit.service';

type StartBody = z.output<typeof startCallSchema>;
type SettingsBody = z.output<typeof callSettingsSchema>;

@Controller('calls')
export class CallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly livekit: LivekitService,
    private readonly storage: StorageService,
  ) {}

  @Post()
  start(@CurrentUser() me: AuthUser, @Body(new ZodPipe(startCallSchema)) body: StartBody) {
    return this.calls.start(me.id, body);
  }

  // Static routes come before `:id`.

  @Get('active')
  active(@CurrentUser() me: AuthUser) {
    return this.calls.active(me.id);
  }

  @Get('history')
  history(@CurrentUser() me: AuthUser, @Query('before') before?: string, @Query('take') take?: string) {
    return this.calls.history(me.id, before || undefined, Number(take) || 30);
  }

  @Get('settings')
  settings(@CurrentUser() me: AuthUser) {
    return this.calls.settings(me.id);
  }

  @Put('settings')
  updateSettings(@CurrentUser() me: AuthUser, @Body(new ZodPipe(callSettingsSchema)) body: SettingsBody) {
    return this.calls.updateSettings(me.id, body as Required<CallSettingsInput>);
  }

  @Get('speed-dial')
  speedDial(@CurrentUser() me: AuthUser) {
    return this.calls.speedDial(me.id);
  }

  @Put('speed-dial/:userId')
  addSpeedDial(@CurrentUser() me: AuthUser, @Param('userId') userId: string) {
    return this.calls.addSpeedDial(me.id, userId);
  }

  @Delete('speed-dial/:userId')
  removeSpeedDial(@CurrentUser() me: AuthUser, @Param('userId') userId: string) {
    return this.calls.removeSpeedDial(me.id, userId);
  }

  /**
   * LiveKit server webhooks (participant joined/left, room finished). Authenticated by LiveKit's signed
   * Authorization header, which covers a hash of the raw body (main.ts keeps this content type unparsed).
   */
  @Public()
  @Post('livekit-webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request, @Headers('authorization') auth?: string) {
    if (!Buffer.isBuffer(req.body)) throw new BadRequestException('Expected application/webhook+json');
    const event = await this.livekit.receive(req.body.toString('utf8'), auth).catch(() => {
      throw new UnauthorizedException('Invalid webhook signature');
    });
    await this.calls.onWebhook(event);
    return { ok: true };
  }

  @Get(':id')
  get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.calls.get(me.id, id);
  }

  /** Accept a ring, join a running call, or reconnect. Returns the LiveKit URL and token. */
  @Post(':id/join')
  join(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.calls.join(me.id, id);
  }

  @Post(':id/decline')
  @HttpCode(204)
  decline(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.calls.decline(me.id, id);
  }

  @Post(':id/leave')
  @HttpCode(204)
  leave(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.calls.leave(me.id, id);
  }

  @Post(':id/end')
  @HttpCode(204)
  end(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.calls.end(me.id, id);
  }

  @Post(':id/invite')
  invite(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(inviteToCallSchema)) body: InviteToCallInput) {
    return this.calls.invite(me.id, id, body.userIds);
  }

  @Post(':id/hold')
  hold(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(holdCallSchema)) body: HoldCallInput) {
    return this.calls.hold(me.id, id, body.onHold);
  }

  @Post(':id/transfer')
  @HttpCode(204)
  transfer(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body(new ZodPipe(transferCallSchema)) body: TransferCallInput) {
    return this.calls.transfer(me.id, id, body.userId);
  }

  /** Multipart: `file` (the recording) and `durationSec`. Only the caller of a missed 1:1 call may leave one. */
  @Post(':id/voicemail')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({ destination: tmpdir() }),
      limits: { fileSize: MAX_VOICEMAIL_BYTES, files: 1 },
    }),
  )
  async voicemail(
    @CurrentUser() me: AuthUser,
    @Param('id') id: string,
    @Body('durationSec') durationSec: string | undefined,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No recording uploaded');
    try {
      return await this.calls.leaveVoicemail(me.id, id, file, Number(durationSec) || 0, (key) =>
        this.storage.put(key, createReadStream(file.path), file.mimetype.split(';')[0], file.size),
      );
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }
}

@Controller('voicemails')
export class VoicemailsController {
  constructor(
    private readonly calls: CallsService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  list(@CurrentUser() me: AuthUser) {
    return this.calls.voicemails(me.id);
  }

  @Post(':id/listened')
  listened(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.calls.markVoicemailListened(me.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.calls.deleteVoicemail(me.id, id);
  }

  /** Signed-URL playback (see StorageService.sign), so an <audio> element can load it without an auth header. */
  @Public()
  @Get(':id/content')
  async content(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    if (!this.storage.verify(id, exp, sig)) throw new ForbiddenException('This link has expired');
    const vm = await this.prisma.voicemail.findUnique({ where: { id } });
    if (!vm) throw new NotFoundException();
    const object = await this.storage.get(vm.storageKey);
    res.setHeader('Content-Type', vm.mimeType);
    res.setHeader('Content-Length', String(vm.size));
    res.setHeader('Content-Disposition', 'inline; filename="voicemail.webm"');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; media-src 'self'");
    object.body.pipe(res);
  }
}
