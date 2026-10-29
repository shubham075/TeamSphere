import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, NotFoundException, Param,
  Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { diskStorage } from 'multer';
import {
  AccessRequestInput, accessRequestSchema, CreateFolderInput, createFolderSchema, CreateShareLinkInput,
  createShareLinkSchema, DecideAccessRequestInput, decideAccessRequestSchema, fileNameSchema, MAX_FILE_BYTES,
  MoveFileInput, moveFileSchema, RenameFileInput, renameFileSchema, ShareFileInput, shareFileSchema,
} from '@teamsphere/shared';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { StorageService } from '../infra/storage';
import { FilesService, UploadedContent } from './files.service';

const upload = FileInterceptor('file', { storage: diskStorage({ destination: tmpdir() }), limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|bmp)|video\/(mp4|webm|ogg)|audio\/|application\/pdf$|text\/plain$)/;

const ctx = (req: Request) => ({ ip: req.ip ?? null });

/** Multer temp file → storage, with a usable UTF-8 name (browsers send multipart filenames as latin1). */
function content(file: Express.Multer.File | undefined, storage: StorageService): UploadedContent {
  if (!file) throw new BadRequestException('No file uploaded');
  const raw = Buffer.from(file.originalname, 'latin1').toString('utf8');
  const parsed = fileNameSchema.safeParse(raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || 'file');
  if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
  return {
    name: parsed.data,
    mimeType: file.mimetype || 'application/octet-stream',
    size: file.size,
    store: (key) => storage.put(key, createReadStream(file.path), file.mimetype || 'application/octet-stream', file.size),
  };
}

@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly storage: StorageService,
  ) {}

  @Get('folder')
  folder(@CurrentUser() me: AuthUser, @Query('id') id?: string) {
    return this.files.listFolder(me.id, id || null);
  }

  @Get('shared')
  shared(@CurrentUser() me: AuthUser) {
    return this.files.sharedWithMe(me.id);
  }

  @Get('recent')
  recent(@CurrentUser() me: AuthUser) {
    return this.files.recent(me.id);
  }

  @Get('search')
  search(@CurrentUser() me: AuthUser, @Query('q') q = '') {
    return this.files.search(me.id, q.slice(0, 200));
  }

  @Get('recycle-bin')
  recycleBin(@CurrentUser() me: AuthUser) {
    return this.files.recycleBin(me.id);
  }

  @Delete('recycle-bin')
  @HttpCode(204)
  emptyRecycleBin(@CurrentUser() me: AuthUser, @Req() req: Request) {
    return this.files.emptyRecycleBin(me.id, ctx(req));
  }

  @Get('chat-files')
  chatFiles(@CurrentUser() me: AuthUser) {
    return this.files.chatFiles(me.id);
  }

  @Post('folders')
  createFolder(@CurrentUser() me: AuthUser, @Req() req: Request, @Body(new ZodPipe(createFolderSchema)) body: CreateFolderInput) {
    return this.files.createFolder(me.id, body, ctx(req));
  }

  @Post('upload')
  @UseInterceptors(upload)
  async upload(@CurrentUser() me: AuthUser, @Req() req: Request, @Query('parentId') parentId?: string, @UploadedFile() file?: Express.Multer.File) {
    try {
      return await this.files.upload(me.id, parentId || null, content(file, this.storage), ctx(req));
    } finally {
      if (file) await unlink(file.path).catch(() => undefined);
    }
  }

  @Get('items/:id')
  detail(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string) {
    return this.files.detail(me.id, id, ctx(req));
  }

  @Patch('items/:id')
  rename(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string, @Body(new ZodPipe(renameFileSchema)) body: RenameFileInput) {
    return this.files.rename(me.id, id, body.name, ctx(req));
  }

  @Post('items/:id/move')
  move(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string, @Body(new ZodPipe(moveFileSchema)) body: MoveFileInput) {
    return this.files.move(me.id, id, body.parentId, ctx(req));
  }

  @Post('items/:id/copy')
  copy(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string, @Body(new ZodPipe(moveFileSchema)) body: MoveFileInput) {
    return this.files.copy(me.id, id, body.parentId, ctx(req));
  }

  @Delete('items/:id')
  @HttpCode(204)
  remove(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string) {
    return this.files.softDelete(me.id, id, ctx(req));
  }

  @Post('items/:id/restore')
  restore(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string) {
    return this.files.restore(me.id, id, ctx(req));
  }

  @Delete('items/:id/permanent')
  @HttpCode(204)
  purge(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string) {
    return this.files.purge(me.id, id, ctx(req));
  }

  @Get('items/:id/versions')
  versions(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.files.versions(me.id, id);
  }

  @Post('items/:id/versions')
  @UseInterceptors(upload)
  async addVersion(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    try {
      return await this.files.addVersion(me.id, id, content(file, this.storage), ctx(req));
    } finally {
      if (file) await unlink(file.path).catch(() => undefined);
    }
  }

  @Post('items/:id/versions/:versionId/restore')
  restoreVersion(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string, @Param('versionId') versionId: string) {
    return this.files.restoreVersion(me.id, id, versionId, ctx(req));
  }

  @Get('items/:id/sharing')
  sharing(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.files.sharing(me.id, id);
  }

  @Post('items/:id/shares')
  share(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string, @Body(new ZodPipe(shareFileSchema)) body: ShareFileInput) {
    return this.files.share(me.id, id, body, ctx(req));
  }

  @Delete('items/:id/shares/:userId')
  unshare(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string, @Param('userId') userId: string) {
    return this.files.unshare(me.id, id, userId, ctx(req));
  }

  @Post('items/:id/links')
  createLink(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string, @Body(new ZodPipe(createShareLinkSchema)) body: CreateShareLinkInput) {
    return this.files.createLink(me.id, id, body.role, ctx(req));
  }

  @Delete('links/:linkId')
  @HttpCode(204)
  revokeLink(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('linkId') linkId: string) {
    return this.files.revokeLink(me.id, linkId, ctx(req));
  }

  @Post('links/:token/redeem')
  redeem(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('token') token: string) {
    return this.files.redeemLink(me.id, token, ctx(req));
  }

  @Post('items/:id/access-requests')
  @HttpCode(204)
  requestAccess(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string, @Body(new ZodPipe(accessRequestSchema)) body: AccessRequestInput) {
    return this.files.requestAccess(me.id, id, body, ctx(req));
  }

  @Get('access-requests')
  accessRequests(@CurrentUser() me: AuthUser) {
    return this.files.incomingRequests(me.id);
  }

  @Post('access-requests/:id')
  @HttpCode(204)
  decide(@CurrentUser() me: AuthUser, @Req() req: Request, @Param('id') id: string, @Body(new ZodPipe(decideAccessRequestSchema)) body: DecideAccessRequestInput) {
    return this.files.decideRequest(me.id, id, body, ctx(req));
  }

  /**
   * Signed-URL content (see StorageService.sign). URLs are only handed out by `GET items/:id` and the version list,
   * both of which check access, so this works in <img>/<video>/<iframe> without an auth header. Supports Range.
   */
  @Public()
  @Get('content/:versionId')
  async content(
    @Param('versionId') versionId: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Query('download') download: string | undefined,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    if (!this.storage.verify(`fv:${versionId}`, exp, sig)) throw new ForbiddenException('This link has expired');
    const version = await this.files.version(versionId);
    if (!version || version.file.deletedAt) throw new NotFoundException();
    const inline = !download && INLINE_TYPES.test(version.mimeType);
    res.setHeader('Content-Type', inline ? version.mimeType : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(version.file.name)}`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
    if (range && /^bytes=\d*-\d*$/.test(range) && version.size > 0) {
      const object = await this.storage.getRange(version.storageKey, range);
      res.status(206);
      if (object.contentRange) res.setHeader('Content-Range', object.contentRange);
      if (object.size !== undefined) res.setHeader('Content-Length', String(object.size));
      object.body.pipe(res);
      return;
    }
    const object = await this.storage.get(version.storageKey);
    res.setHeader('Content-Length', String(version.size));
    object.body.pipe(res);
  }
}
