import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException,
  Param, Post, Query, Req, Res,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import {
  AuthProvidersInfo, AuthResponse, LoginInput, loginSchema, SessionInfo,
} from '@teamsphere/shared';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';
import { clientInfo } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';
import { EntraLoginState, EntraService } from './entra.service';
import { IssuedSession, SessionService } from './session.service';

const REFRESH_COOKIE = 'ts_refresh';
const ENTRA_COOKIE = 'ts_entra';
/** Browsers can't send custom headers cross-site without CORS approval, so this blocks CSRF on cookie routes. */
const CSRF_HEADER = 'x-teamsphere';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly entra: EntraService,
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Get('providers')
  providers(): AuthProvidersInfo {
    return {
      local: true,
      ldap: { enabled: this.env.LDAP_ENABLED, label: this.env.LDAP_LABEL },
      entra: { enabled: this.env.ENTRA_ENABLED, label: 'Sign in with Microsoft' },
    };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const client = clientInfo(req);
    const user =
      body.provider === 'ldap'
        ? await this.auth.loginLdap(body.username, body.password, client.ip)
        : await this.auth.loginLocal(body.username, body.password, client.ip);
    return this.issue(await this.sessions.create(user, client), res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    this.assertCsrf(req);
    const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new ForbiddenException('Not signed in');
    try {
      return this.issue(await this.sessions.rotate(token), res);
    } catch (e) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.assertCsrf(req);
    const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
    if (token) await this.sessions.revokeByToken(token);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  // ---- Microsoft Entra ID ----

  @Public()
  @Get('entra/login')
  async entraLogin(@Res() res: Response): Promise<void> {
    if (!this.entra.enabled) throw new NotFoundException();
    const { url, state } = await this.entra.buildLoginUrl();
    const signed = await this.jwt.signAsync(state, {
      secret: this.env.JWT_REFRESH_SECRET,
      audience: 'entra-login',
      expiresIn: '10m',
    });
    res.cookie(ENTRA_COOKIE, signed, { ...this.cookieOptions('/api/auth/entra'), maxAge: 10 * 60 * 1000 });
    res.redirect(url);
  }

  @Public()
  @Get('entra/callback')
  async entraCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error_description') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const fail = (msg: string) => res.redirect(`${this.env.WEB_ORIGIN}/login?error=${encodeURIComponent(msg)}`);
    res.clearCookie(ENTRA_COOKIE, this.cookieOptions('/api/auth/entra'));
    if (!this.entra.enabled) return fail('Microsoft sign-in is not enabled');
    if (error) return fail(error);

    try {
      const saved = await this.jwt.verifyAsync<EntraLoginState>(req.cookies?.[ENTRA_COOKIE] ?? '', {
        secret: this.env.JWT_REFRESH_SECRET,
        audience: 'entra-login',
      });
      const client = clientInfo(req);
      const profile = await this.entra.handleCallback(code, state, saved);
      const user = await this.auth.loginEntra(profile, client.ip);
      const session = await this.sessions.create(user, client);
      this.setRefreshCookie(res, session);
      res.redirect(`${this.env.WEB_ORIGIN}/`);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Microsoft sign-in failed');
    }
  }

  // ---- Device sessions ----

  @Get('sessions')
  async listSessions(@CurrentUser() me: AuthUser): Promise<SessionInfo[]> {
    const rows = await this.sessions.listActive(me.id);
    return rows.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === me.sessionId,
    }));
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@CurrentUser() me: AuthUser, @Param('id') id: string): Promise<void> {
    if (!(await this.sessions.revoke(me.id, id))) throw new NotFoundException();
  }

  @Post('sessions/revoke-others')
  @HttpCode(204)
  async revokeOthers(@CurrentUser() me: AuthUser): Promise<void> {
    await this.sessions.revokeAll(me.id, me.sessionId);
  }

  // ---- helpers ----

  private issue(session: IssuedSession, res: Response): AuthResponse {
    this.setRefreshCookie(res, session);
    return { accessToken: session.accessToken, user: session.user };
  }

  private setRefreshCookie(res: Response, session: IssuedSession) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...this.cookieOptions(),
      expires: session.refreshExpiresAt,
    });
  }

  private cookieOptions(path = '/api/auth'): CookieOptions {
    return { httpOnly: true, sameSite: 'lax', secure: this.env.NODE_ENV === 'production', path };
  }

  private assertCsrf(req: Request) {
    if (req.headers[CSRF_HEADER] !== '1') throw new BadRequestException('Missing request header');
  }
}
