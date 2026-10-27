import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

interface OidcMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

/** Short-lived values kept in a signed cookie between the redirect and the callback. */
export interface EntraLoginState {
  state: string;
  nonce: string;
  verifier: string;
}

export interface EntraProfile {
  externalId: string;
  username: string;
  displayName: string;
  email: string | null;
  jobTitle: string | null;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/** Microsoft Entra ID sign-in: OpenID Connect authorization code flow with PKCE. */
@Injectable()
export class EntraService {
  private metadata?: Promise<OidcMetadata>;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled() {
    return this.env.ENTRA_ENABLED;
  }

  async buildLoginUrl(): Promise<{ url: string; state: EntraLoginState }> {
    const meta = await this.getMetadata();
    const state: EntraLoginState = {
      state: b64url(randomBytes(24)),
      nonce: b64url(randomBytes(24)),
      verifier: b64url(randomBytes(48)),
    };
    const challenge = b64url(createHash('sha256').update(state.verifier).digest());
    const url = new URL(meta.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: this.env.ENTRA_CLIENT_ID!,
      response_type: 'code',
      redirect_uri: this.env.ENTRA_REDIRECT_URI!,
      response_mode: 'query',
      scope: 'openid profile email',
      state: state.state,
      nonce: state.nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString(), state };
  }

  async handleCallback(code: string, returnedState: string, saved: EntraLoginState): Promise<EntraProfile> {
    if (!code || returnedState !== saved.state) throw new UnauthorizedException('Invalid sign-in state');
    const meta = await this.getMetadata();

    const res = await fetch(meta.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.env.ENTRA_CLIENT_ID!,
        client_secret: this.env.ENTRA_CLIENT_SECRET!,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.env.ENTRA_REDIRECT_URI!,
        code_verifier: saved.verifier,
      }),
    });
    const body = (await res.json()) as { id_token?: string; error_description?: string };
    if (!res.ok || !body.id_token) {
      throw new UnauthorizedException(body.error_description ?? 'Token exchange failed');
    }

    this.jwks ??= createRemoteJWKSet(new URL(meta.jwks_uri));
    const { payload } = await jwtVerify(body.id_token, this.jwks, {
      issuer: meta.issuer,
      audience: this.env.ENTRA_CLIENT_ID!,
    });
    if (payload.nonce !== saved.nonce) throw new UnauthorizedException('Invalid nonce');
    return this.toProfile(payload);
  }

  private toProfile(p: JWTPayload): EntraProfile {
    const claims = p as JWTPayload & Record<string, string | undefined>;
    const upn = (claims.preferred_username ?? claims.upn ?? claims.email ?? '').toLowerCase();
    if (!claims.oid || !upn) throw new UnauthorizedException('Entra token is missing oid/username');
    return {
      externalId: claims.oid,
      username: upn,
      displayName: claims.name ?? upn,
      email: (claims.email ?? (upn.includes('@') ? upn : undefined))?.toLowerCase() ?? null,
      jobTitle: claims.jobTitle ?? null,
    };
  }

  private getMetadata(): Promise<OidcMetadata> {
    this.metadata ??= fetch(
      `https://login.microsoftonline.com/${this.env.ENTRA_TENANT_ID}/v2.0/.well-known/openid-configuration`,
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`Entra discovery failed: HTTP ${r.status}`);
        return (await r.json()) as OidcMetadata;
      })
      .catch((e) => {
        // Don't cache a failure; retry discovery on the next sign-in.
        this.metadata = undefined;
        throw e;
      });
    return this.metadata;
  }
}
