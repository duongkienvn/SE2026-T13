import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { EnvironmentConfig } from '../../config/environment';
import { ApplicationException } from '../../exceptions/application.exception';
import { VerificationMailer } from '../../mail/verification-mailer';
import { User } from '../users/entities/user.entity';
import { EmailVerificationToken } from './entities/email-verification-token.entity';

export const VERIFICATION_COOLDOWN_MS = 60_000;
const WINDOW_MS = 60 * 60_000;
const MAX_ATTEMPTS = 5;
const TOKEN_TTL_MS = 24 * WINDOW_MS;

export function verificationHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly source: DataSource,
    private readonly mailer: VerificationMailer,
    private readonly config: ConfigService<EnvironmentConfig, true>,
  ) {}

  async send(email: string, reportDeliveryFailure = false): Promise<void> {
    const issued = await this.source.transaction(async (manager) => {
      // Every verify/rotate locks User first, then reads the current token.
      const user = await manager
        .getRepository(User)
        .findOne({ where: { email }, lock: { mode: 'pessimistic_write' } });
      if (!user || user.emailVerifiedAt !== null) return null;
      const tokens = manager.getRepository(EmailVerificationToken);
      const previous = await tokens.findOne({ where: { userId: user.id } });
      const now = new Date();
      if (
        previous &&
        now.getTime() - previous.createdAt.getTime() < VERIFICATION_COOLDOWN_MS
      )
        return null;
      const sameWindow =
        previous &&
        now.getTime() - previous.windowStartedAt.getTime() < WINDOW_MS;
      if (sameWindow && previous.attempts >= MAX_ATTEMPTS) return null;
      const plaintext = randomBytes(32).toString('base64url');
      const token = tokens.create({
        ...(previous ?? {}),
        userId: user.id,
        tokenHash: verificationHash(plaintext),
        createdAt: now,
        expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
        consumedAt: null,
        sentAt: null,
        windowStartedAt: sameWindow ? previous.windowStartedAt : now,
        attempts: sameWindow ? previous.attempts + 1 : 1,
      });
      await tokens.save(token);
      return { token, plaintext, email: user.email };
    });
    if (!issued) return;
    const url = new URL(
      '/verify-email',
      this.config.get('PUBLIC_APP_URL', { infer: true }),
    );
    url.searchParams.set('token', issued.plaintext);
    try {
      // No DB transaction/row lock crosses this network call. No automatic retry.
      await this.mailer.send(
        issued.email,
        url.toString(),
        `verification/${issued.token.tokenHash}`,
      );
    } catch {
      // An ambiguous timeout can still deliver: retain this token until explicit
      // rotation/expiry. Failed attempts count toward the same persistent quota.
      if (reportDeliveryFailure)
        throw new ApplicationException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'MAIL_DELIVERY_UNAVAILABLE',
          'Account created, but verification email could not be requested. Please use resend verification.',
        );
      // Resend always has a conditional generic response, including provider
      // failure. Do not disclose which email addresses have pending accounts.
      return;
    }
    await this.source
      .getRepository(EmailVerificationToken)
      .update(
        { userId: issued.token.userId, tokenHash: issued.token.tokenHash },
        { sentAt: new Date() },
      );
  }

  async verify(plaintext: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(plaintext)) throw this.invalid();
    const hash = verificationHash(plaintext);
    // Only discover the immutable owner here; token state is re-read after lock.
    const candidate = await this.source
      .getRepository(EmailVerificationToken)
      .findOne({ where: { tokenHash: hash } });
    if (!candidate) throw this.invalid();
    await this.source.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const user = await users.findOne({
        where: { id: candidate.userId },
        lock: { mode: 'pessimistic_write' },
      });
      const tokens = manager.getRepository(EmailVerificationToken);
      const token = await tokens.findOne({
        where: { userId: candidate.userId },
      });
      const now = new Date();
      if (
        !user ||
        user.emailVerifiedAt !== null ||
        !token ||
        token.tokenHash !== hash ||
        token.consumedAt ||
        token.expiresAt <= now
      )
        throw this.invalid();
      user.emailVerifiedAt = now;
      token.consumedAt = now;
      await users.save(user);
      await tokens.save(token);
    });
  }

  private invalid(): ApplicationException {
    return new ApplicationException(
      HttpStatus.BAD_REQUEST,
      'INVALID_VERIFICATION_TOKEN',
      'Verification link is invalid or has expired. Request a new link.',
    );
  }
}
