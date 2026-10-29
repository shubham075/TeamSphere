import {
  BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode,
  NotFoundException, Param, Patch, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { hash, verify } from '@node-rs/argon2';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  ChangePasswordInput, changePasswordSchema, passwordSchema, CreateUserInput, createUserSchema, OutOfOfficeInput,
  outOfOfficeSchema, OutOfOfficeSettings, PresenceInfo, PublicUser, SetPresenceInput, setPresenceSchema,
  SetStatusMessageInput, setStatusMessageSchema, UpdateProfileInput, updateProfileSchema,
} from '@teamsphere/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { StorageService } from '../infra/storage';
import { computePresence, PresenceService } from '../presence/presence.service';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { toPublicUser } from './users.mapper';

const setActiveSchema = z.object({ isActive: z.boolean() });
const resetPasswordSchema = z.object({ password: passwordSchema });

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** Detects the image type from its first bytes; the browser-sent MIME type isn't trusted (and SVG is never accepted). */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function toOooSettings(u: { oooEnabled: boolean; oooMessage: string | null; oooStartAt: Date | null; oooEndAt: Date | null }): OutOfOfficeSettings {
  return {
    enabled: u.oooEnabled,
    message: u.oooMessage,
    startAt: u.oooStartAt?.toISOString() ?? null,
    endAt: u.oooEndAt?.toISOString() ?? null,
  };
}

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly presence: PresenceService,
    private readonly storage: StorageService,
  ) {}

  @Get('me')
  async me(@CurrentUser() me: AuthUser): Promise<PublicUser & { presence: PresenceInfo }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    return { ...toPublicUser(user), presence: computePresence(user, true) }; // the caller is online by definition
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() me: AuthUser,
    @Body(new ZodPipe(updateProfileSchema)) body: UpdateProfileInput,
  ): Promise<PublicUser> {
    if (body.email) {
      const owner = await this.prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
      if (owner && owner.id !== me.id) throw new ConflictException('That email is used by another account');
    }
    return toPublicUser(await this.prisma.user.update({ where: { id: me.id }, data: body }));
  }

  @Post('me/password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() me: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: Request,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    if (user.authProvider !== 'local' || !user.passwordHash) {
      throw new BadRequestException('Your password is managed by your company directory');
    }
    if (!(await verify(user.passwordHash, body.currentPassword))) {
      throw new BadRequestException('Current password is incorrect');
    }
    await this.prisma.user.update({ where: { id: me.id }, data: { passwordHash: await hash(body.newPassword) } });
    await this.sessions.revokeAll(me.id, me.sessionId);
    this.audit.log({ actorId: me.id, action: 'user.password_changed', ip: req.ip });
  }

  @Put('me/presence')
  async setPresence(
    @CurrentUser() me: AuthUser,
    @Body(new ZodPipe(setPresenceSchema)) body: SetPresenceInput,
  ): Promise<PresenceInfo> {
    const user = await this.prisma.user.update({
      where: { id: me.id },
      data: {
        presenceStatus: body.status === 'available' ? null : body.status,
        presenceExpiresAt: body.until ? new Date(body.until) : null,
      },
    });
    await this.presence.broadcast(user.id);
    return this.presence.get(user.id);
  }

  @Put('me/status-message')
  async setStatusMessage(
    @CurrentUser() me: AuthUser,
    @Body(new ZodPipe(setStatusMessageSchema)) body: SetStatusMessageInput,
  ): Promise<PresenceInfo> {
    const user = await this.prisma.user.update({
      where: { id: me.id },
      data: { statusMessage: body.message || null, statusExpiresAt: body.expiresAt ? new Date(body.expiresAt) : null },
    });
    await this.presence.broadcast(user.id);
    return this.presence.get(user.id);
  }

  @Get('me/out-of-office')
  async getOutOfOffice(@CurrentUser() me: AuthUser): Promise<OutOfOfficeSettings> {
    return toOooSettings(await this.prisma.user.findUniqueOrThrow({ where: { id: me.id } }));
  }

  @Put('me/out-of-office')
  async setOutOfOffice(
    @CurrentUser() me: AuthUser,
    @Body(new ZodPipe(outOfOfficeSchema)) body: OutOfOfficeInput,
  ): Promise<OutOfOfficeSettings> {
    const user = await this.prisma.user.update({
      where: { id: me.id },
      data: {
        oooEnabled: body.enabled,
        oooMessage: body.message || null,
        oooStartAt: body.startAt ? new Date(body.startAt) : null,
        oooEndAt: body.endAt ? new Date(body.endAt) : null,
      },
    });
    // A new absence should produce a fresh auto-reply even in chats that got one recently.
    if (body.enabled) await this.prisma.conversationMember.updateMany({ where: { userId: me.id }, data: { oooRepliedAt: null } });
    await this.presence.broadcast(me.id);
    return toOooSettings(user);
  }

  @Put('me/avatar')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } }))
  async setAvatar(@CurrentUser() me: AuthUser, @UploadedFile() file?: Express.Multer.File): Promise<PublicUser> {
    if (!file) throw new BadRequestException('No file uploaded');
    const type = sniffImage(file.buffer);
    if (!type) throw new BadRequestException('Use a PNG, JPEG, GIF or WebP image');
    const previous = await this.prisma.user.findUniqueOrThrow({ where: { id: me.id }, select: { avatarKey: true } });
    const key = `avatars/${me.id}/${randomBytes(16).toString('base64url')}`;
    await this.storage.put(key, file.buffer, type, file.size);
    const user = await this.prisma.user.update({ where: { id: me.id }, data: { avatarKey: key } });
    if (previous.avatarKey) await this.storage.remove(previous.avatarKey);
    return toPublicUser(user);
  }

  @Delete('me/avatar')
  async removeAvatar(@CurrentUser() me: AuthUser): Promise<PublicUser> {
    const previous = await this.prisma.user.findUniqueOrThrow({ where: { id: me.id }, select: { avatarKey: true } });
    const user = await this.prisma.user.update({ where: { id: me.id }, data: { avatarKey: null } });
    if (previous.avatarKey) await this.storage.remove(previous.avatarKey);
    return toPublicUser(user);
  }

  /** Capability URL (see users.mapper avatarUrl): `v` must match the current avatar's random key segment. */
  @Public()
  @Get(':id/avatar')
  async avatar(@Param('id') id: string, @Query('v') v: string | undefined, @Res() res: Response) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { avatarKey: true } });
    if (!user?.avatarKey || !v || user.avatarKey !== `avatars/${id}/${v}`) throw new ForbiddenException();
    const object = await this.storage.get(user.avatarKey);
    res.setHeader('Content-Type', object.contentType ?? 'application/octet-stream');
    if (object.size) res.setHeader('Content-Length', String(object.size));
    // The URL changes with every upload, so it can be cached for good.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    object.body.pipe(res);
  }

  /** People directory / people picker. */
  @Get()
  async search(
    @CurrentUser() me: AuthUser,
    @Query('q') q = '',
    @Query('take') take = '25',
    @Query('includeInactive') includeInactive?: string,
  ): Promise<PublicUser[]> {
    const term = q.trim();
    const users = await this.prisma.user.findMany({
      where: {
        // Admins can list disabled accounts (to re-enable them); everyone else only sees active people.
        ...(includeInactive === '1' && me.role === 'admin' ? {} : { isActive: true }),
        ...(term
          ? {
              OR: [
                { displayName: { contains: term, mode: 'insensitive' } },
                { username: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
                { department: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { displayName: 'asc' },
      take: Math.min(Math.max(Number(take) || 25, 1), 100),
    });
    return users.map(toPublicUser);
  }

  @Get(':id')
  async getOne(@Param('id') id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException();
    return toPublicUser(user);
  }

  // ---- Admin ----

  @Roles('admin')
  @Post()
  async create(
    @CurrentUser() me: AuthUser,
    @Body(new ZodPipe(createUserSchema)) body: CreateUserInput,
  ): Promise<PublicUser> {
    const username = body.username.toLowerCase();
    const clash = await this.prisma.user.findFirst({
      where: { OR: [{ username }, ...(body.email ? [{ email: body.email }] : [])] },
    });
    if (clash) throw new ConflictException('Username or email already exists');
    const { password, ...rest } = body;
    const user = await this.prisma.user.create({
      data: { ...rest, username, passwordHash: await hash(password), authProvider: 'local' },
    });
    this.audit.log({ actorId: me.id, action: 'admin.user_created', targetType: 'user', targetId: user.id });
    return toPublicUser(user);
  }

  @Roles('admin')
  @Post(':id/password')
  @HttpCode(204)
  async resetPassword(
    @CurrentUser() me: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException();
    if (user.authProvider !== 'local') {
      throw new BadRequestException('This person signs in with the company directory; reset their password there');
    }
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await hash(body.password) } });
    await this.sessions.revokeAll(id);
    this.audit.log({ actorId: me.id, action: 'admin.password_reset', targetType: 'user', targetId: id });
  }

  @Roles('admin')
  @Patch(':id/active')
  async setActive(
    @CurrentUser() me: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(setActiveSchema)) body: z.infer<typeof setActiveSchema>,
  ): Promise<PublicUser> {
    if (id === me.id && !body.isActive) throw new BadRequestException('You cannot disable your own account');
    const user = await this.prisma.user.update({ where: { id }, data: { isActive: body.isActive } });
    if (!body.isActive) await this.sessions.revokeAll(id);
    this.audit.log({
      actorId: me.id,
      action: body.isActive ? 'admin.user_enabled' : 'admin.user_disabled',
      targetType: 'user',
      targetId: id,
    });
    return toPublicUser(user);
  }
}
