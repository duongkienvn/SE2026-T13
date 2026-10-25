import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { isEmail } from 'class-validator';
import { EnvironmentConfig } from '../../config/environment';
import { ApplicationException } from '../../exceptions/application.exception';
import { ErrorCode } from '../../common/dto/api-error';

export interface GoogleProfile {
  sub: string;
  email: string;
  authoritativeEmail: boolean;
  displayName: string;
  avatarUrl: string | null;
}

function safeAvatar(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

@Injectable()
export class GoogleTokenVerifier {
  private readonly client = new OAuth2Client({
    transporterOptions: { timeout: 5000, retry: false },
  });

  constructor(
    private readonly config: ConfigService<EnvironmentConfig, true>,
  ) {}

  async verify(credential: string): Promise<GoogleProfile> {
    const audience = this.config.get('GOOGLE_CLIENT_ID', { infer: true });
    if (!audience) throw this.unavailable();
    let payload;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken: credential,
        audience,
      });
      payload = ticket.getPayload();
    } catch (error) {
      // Never propagate SDK messages: they may include the raw JWT or claims.
      // Certificate-fetch failures are operational failures, not bad credentials.
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : undefined;
      const response =
        typeof error === 'object' && error !== null && 'response' in error
          ? error.response
          : undefined;
      if (code || response) throw this.unavailable();
      throw this.invalid();
    }
    const now = Date.now() / 1000;
    if (
      !payload ||
      payload.aud !== audience ||
      !['accounts.google.com', 'https://accounts.google.com'].includes(
        payload.iss,
      ) ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= now ||
      !Number.isFinite(payload.iat) ||
      payload.iat > now + 300 ||
      typeof payload.sub !== 'string' ||
      !/^[A-Za-z0-9_-]{1,255}$/.test(payload.sub) ||
      typeof payload.email !== 'string' ||
      payload.email.length > 254 ||
      !isEmail(payload.email) ||
      payload.email_verified !== true
    )
      throw this.invalid();
    const email = payload.email.trim().toLowerCase();
    const domain = email.slice(email.lastIndexOf('@') + 1);
    const hosted =
      typeof payload.hd === 'string' && payload.hd.toLowerCase() === domain;
    const displayName =
      typeof payload.name === 'string'
        ? payload.name
            .replace(/[\p{Cc}\p{Cf}]/gu, '')
            .trim()
            .slice(0, 80)
        : '';
    return {
      sub: payload.sub,
      email,
      authoritativeEmail: domain === 'gmail.com' || hosted,
      displayName: displayName.length >= 2 ? displayName : 'Google user',
      avatarUrl: safeAvatar(payload.picture),
    };
  }

  private invalid(): ApplicationException {
    return new ApplicationException(
      401,
      ErrorCode.INVALID_GOOGLE_CREDENTIAL,
      'Google sign-in could not be verified. Please try again.',
    );
  }
  private unavailable(): ApplicationException {
    return new ApplicationException(
      503,
      ErrorCode.GOOGLE_AUTH_UNAVAILABLE,
      'Google sign-in is unavailable. Please use email and password or try again later.',
    );
  }
}
