import { Inject, Injectable, Logger } from '@nestjs/common';
import { Client } from 'ldapts';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export interface DirectoryUser {
  externalId: string;
  username: string;
  displayName: string;
  email: string | null;
  jobTitle: string | null;
  department: string | null;
  office: string | null;
  phone: string | null;
  isAdmin: boolean;
}

/** RFC 4515 escaping for values placed inside an LDAP filter. */
export function escapeLdapFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

const first = (v: unknown): string | null => {
  if (Array.isArray(v)) return v.length ? String(v[0]) : null;
  return v == null || v === '' ? null : String(v);
};

const ATTRIBUTES = [
  'objectGUID', 'sAMAccountName', 'displayName', 'mail', 'title', 'department',
  'physicalDeliveryOfficeName', 'telephoneNumber', 'memberOf', 'userAccountControl',
];

/**
 * On-prem Active Directory login: bind with the service account, find the user,
 * then bind as that user on a fresh connection to check the password.
 */
@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled() {
    return this.env.LDAP_ENABLED;
  }

  /** Returns the directory profile on success, null on bad credentials, unknown or disabled user. */
  async authenticate(username: string, password: string): Promise<DirectoryUser | null> {
    if (!this.enabled || !password) return null;

    const entry = await this.findUser(username);
    if (!entry) return null;

    // userAccountControl bit 2 = ACCOUNTDISABLE
    if (Number(first(entry.userAccountControl) ?? 0) & 2) return null;

    const userClient = this.client();
    try {
      await userClient.bind(String(entry.dn), password);
    } catch {
      return null;
    } finally {
      await userClient.unbind().catch(() => undefined);
    }

    return this.map(entry, username);
  }

  private async findUser(username: string): Promise<Record<string, unknown> | null> {
    const client = this.client();
    try {
      await client.bind(this.env.LDAP_BIND_DN!, this.env.LDAP_BIND_PASSWORD!);
      const filter = this.env.LDAP_USER_FILTER.replace('{{username}}', escapeLdapFilter(username));
      const { searchEntries } = await client.search(this.env.LDAP_BASE_DN!, {
        scope: 'sub',
        filter,
        sizeLimit: 2,
        attributes: ATTRIBUTES,
        explicitBufferAttributes: ['objectGUID'],
      });
      return searchEntries.length === 1 ? searchEntries[0] : null;
    } catch (e) {
      this.logger.error(`LDAP lookup failed: ${e}`);
      throw e;
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  private map(entry: Record<string, unknown>, username: string): DirectoryUser {
    const guid = entry.objectGUID;
    const memberOf = ([] as unknown[]).concat(entry.memberOf ?? []).map(String);
    const adminGroup = this.env.LDAP_ADMIN_GROUP_DN?.toLowerCase();

    return {
      externalId: Buffer.isBuffer(guid) ? guid.toString('hex') : String(entry.dn),
      username: (first(entry.sAMAccountName) ?? username).toLowerCase(),
      displayName: first(entry.displayName) ?? username,
      email: first(entry.mail)?.toLowerCase() ?? null,
      jobTitle: first(entry.title),
      department: first(entry.department),
      office: first(entry.physicalDeliveryOfficeName),
      phone: first(entry.telephoneNumber),
      isAdmin: !!adminGroup && memberOf.some((g) => g.toLowerCase() === adminGroup),
    };
  }

  private client() {
    return new Client({
      url: this.env.LDAP_URL!,
      timeout: 10_000,
      connectTimeout: 10_000,
      tlsOptions: { rejectUnauthorized: this.env.LDAP_TLS_REJECT_UNAUTHORIZED },
    });
  }
}
