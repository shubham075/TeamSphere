import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Patch,
  Post, Put, Query, Req,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ChangePasswordInput, changePasswordSchema, CreateUserInput, createUserSchema, PresenceInfo, PublicUser,
  SetPresenceInput, setPresenceSchema, SetStatusMessageInput, setStatusMessageSchema, UpdateProfileInput,
  updateProfileSchema,
} from '@teamsphere/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { computePresence, PresenceService } from '../presence/presence.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { toPublicUser } from './users.mapper';

const setActiveSchema = z.object({ isActive: z.boolean() });

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly presence: PresenceService,
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

  /** People directory / people picker. */
  @Get()
  async search(@Query('q') q = '', @Query('take') take = '25'): Promise<PublicUser[]> {
    const term = q.trim();
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
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
