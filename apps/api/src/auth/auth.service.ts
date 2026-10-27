import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { AuthProvider, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LdapService } from './ldap.service';

/** Profile fields a directory (AD or Entra) can supply. */
export interface DirectoryProfile {
  externalId: string;
  username: string;
  displayName: string;
  email: string | null;
  jobTitle?: string | null;
  department?: string | null;
  office?: string | null;
  phone?: string | null;
  isAdmin?: boolean;
}

// Verifying against a fixed hash on unknown users keeps response time the same, so usernames can't be probed.
const DUMMY_HASH = hash('teamsphere-timing-equalizer');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ldap: LdapService,
    private readonly audit: AuditService,
  ) {}

  async loginLocal(username: string, password: string, ip: string | null): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    const ok = user?.passwordHash
      ? await verify(user.passwordHash, password)
      : (await verify(await DUMMY_HASH, password), false);
    if (!user || !ok) {
      this.audit.log({ action: 'auth.login_failed', meta: { username, provider: 'local' }, ip });
      throw new UnauthorizedException('Incorrect username or password');
    }
    if (!user.isActive) throw new ForbiddenException('This account has been disabled');
    this.audit.log({ actorId: user.id, action: 'auth.login', meta: { provider: 'local' }, ip });
    return user;
  }

  async loginLdap(username: string, password: string, ip: string | null): Promise<User> {
    if (!this.ldap.enabled) throw new UnauthorizedException('Directory sign-in is not enabled');
    // Accept DOMAIN\user and user@domain forms.
    const bare = username.replace(/^.*\\/, '').replace(/@.*$/, '');
    const profile = await this.ldap.authenticate(bare, password);
    if (!profile) {
      this.audit.log({ action: 'auth.login_failed', meta: { username, provider: 'ldap' }, ip });
      throw new UnauthorizedException('Incorrect username or password');
    }
    const user = await this.provisionDirectoryUser('ldap', profile);
    this.audit.log({ actorId: user.id, action: 'auth.login', meta: { provider: 'ldap' }, ip });
    return user;
  }

  async loginEntra(profile: DirectoryProfile, ip: string | null): Promise<User> {
    const user = await this.provisionDirectoryUser('entra', profile);
    this.audit.log({ actorId: user.id, action: 'auth.login', meta: { provider: 'entra' }, ip });
    return user;
  }

  /**
   * Find or create the user behind a directory identity.
   * 1. Known identity → sync profile.
   * 2. Same email as an existing *directory* account (AD ↔ Entra in hybrid setups) → link.
   *    Local password accounts are never linked automatically.
   * 3. Otherwise create a new account.
   */
  async provisionDirectoryUser(provider: AuthProvider, p: DirectoryProfile): Promise<User> {
    const profileData = {
      displayName: p.displayName,
      ...(p.email ? { email: p.email } : {}),
      ...(p.jobTitle !== undefined ? { jobTitle: p.jobTitle } : {}),
      ...(p.department !== undefined ? { department: p.department } : {}),
      ...(p.office !== undefined ? { office: p.office } : {}),
      ...(p.phone !== undefined ? { phone: p.phone } : {}),
      ...(p.isAdmin ? { role: 'admin' as const } : {}),
    };

    const identity = await this.prisma.userIdentity.findUnique({
      where: { provider_externalId: { provider, externalId: p.externalId } },
      include: { user: true },
    });

    let user: User;
    if (identity) {
      user = identity.user;
      if (!user.isActive) throw new ForbiddenException('This account has been disabled');
      user = await this.prisma.user.update({ where: { id: user.id }, data: await this.withoutEmailClash(user.id, profileData) });
      return user;
    }

    const linkable = p.email
      ? await this.prisma.user.findFirst({ where: { email: p.email, authProvider: { not: 'local' } } })
      : null;
    if (linkable) {
      if (!linkable.isActive) throw new ForbiddenException('This account has been disabled');
      await this.prisma.userIdentity.create({ data: { userId: linkable.id, provider, externalId: p.externalId } });
      this.audit.log({ actorId: linkable.id, action: 'auth.identity_linked', meta: { provider } });
      return this.prisma.user.update({ where: { id: linkable.id }, data: await this.withoutEmailClash(linkable.id, profileData) });
    }

    const username = await this.freeUsername(p.username, provider);
    user = await this.prisma.user.create({
      data: {
        username,
        authProvider: provider,
        ...(await this.withoutEmailClash(null, profileData)),
        identities: { create: { provider, externalId: p.externalId } },
      },
    });
    this.audit.log({ actorId: user.id, action: 'user.provisioned', targetType: 'user', targetId: user.id, meta: { provider } });
    return user;
  }

  private async freeUsername(wanted: string, provider: AuthProvider): Promise<string> {
    const base = wanted.toLowerCase();
    if (!(await this.prisma.user.findUnique({ where: { username: base } }))) return base;
    for (let i = 0; ; i++) {
      const candidate = i === 0 ? `${base}.${provider}` : `${base}.${provider}${i}`;
      if (!(await this.prisma.user.findUnique({ where: { username: candidate } }))) return candidate;
    }
  }

  /** Drops the email from an update if another account already owns it (email is unique). */
  private async withoutEmailClash<T extends { email?: string }>(userId: string | null, data: T): Promise<T> {
    if (!data.email) return data;
    const owner = await this.prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
    if (owner && owner.id !== userId) {
      const { email: _dropped, ...rest } = data;
      return rest as T;
    }
    return data;
  }
}
