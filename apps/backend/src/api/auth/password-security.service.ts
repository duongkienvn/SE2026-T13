import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { DataSource, IsNull } from 'typeorm';
import { EnvironmentConfig } from '../../config/environment';
import { ApplicationException } from '../../exceptions/application.exception';
import { ErrorCode } from '../../common/dto/api-error';
import { PasswordRecoveryMailer } from '../../mail/password-recovery-mailer';
import { User } from '../users/entities/user.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';

export const RECOVERY_COOLDOWN_MS = 60_000;
export const RECOVERY_WINDOW_MS = 60 * 60_000;
export const RECOVERY_MAX_ATTEMPTS = 5;
export const RECOVERY_TTL_MS = 30 * 60_000;
export const RECOVERY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export function recoveryHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class PasswordSecurityService {
  constructor(
    private readonly source: DataSource,
    private readonly mailer: PasswordRecoveryMailer,
    private readonly config: ConfigService<EnvironmentConfig, true>,
  ) {}

  async send(email: string): Promise<void> {
    const issued = await this.source.transaction(async (manager) => {
      // Bound contention before network delivery; all credential flows lock User first.
      await manager.query("SET LOCAL lock_timeout = '2s'");
      await manager.query("SET LOCAL statement_timeout = '3s'");
      const user = await manager
        .getRepository(User)
        .findOne({ where: { email }, lock: { mode: 'pessimistic_write' } });
      if (!user?.emailVerifiedAt) return null;
      const tokens = manager.getRepository(PasswordResetToken);
      const previous = await tokens.findOneBy({ userId: user.id });
      const now = new Date();
      if (
        previous &&
        now.getTime() - previous.createdAt.getTime() < RECOVERY_COOLDOWN_MS
      )
        return null;
      const sameWindow =
        previous &&
        now.getTime() - previous.windowStartedAt.getTime() < RECOVERY_WINDOW_MS;
      if (sameWindow && previous.attempts >= RECOVERY_MAX_ATTEMPTS) return null;
      const plaintext = randomBytes(32).toString('base64url');
      const token = await tokens.save(
        tokens.create({
          ...(previous ?? {}),
          userId: user.id,
          tokenHash: recoveryHash(plaintext),
          createdAt: now,
          expiresAt: new Date(now.getTime() + RECOVERY_TTL_MS),
          consumedAt: null,
          sentAt: null,
          windowStartedAt: sameWindow ? previous.windowStartedAt : now,
          attempts: sameWindow ? previous.attempts + 1 : 1,
        }),
      );
      return { token, plaintext, email: user.email };
    });
    if (!issued) return;
    const url = new URL(
      '/reset-password',
      this.config.get('PUBLIC_APP_URL', { infer: true }),
    );
    url.searchParams.set('token', issued.plaintext);
    try {
      // Committed quota precedes delivery. An ambiguous failure keeps the proof
      // valid and charged to quota; never automatically retry the network call.
      await this.mailer.send(
        issued.email,
        url.toString(),
        `password-recovery/${issued.token.tokenHash}`,
      );
    } catch {
      return;
    }
    await this.source
      .getRepository(PasswordResetToken)
      .update(
        { userId: issued.token.userId, tokenHash: issued.token.tokenHash },
        { sentAt: new Date() },
      );
  }

  async reset(plaintext: unknown, newPassword: string): Promise<void> {
    if (
      typeof plaintext !== 'string' ||
      !RECOVERY_TOKEN_PATTERN.test(plaintext)
    )
      throw this.invalidToken();
    const hash = recoveryHash(plaintext);
    const candidate = await this.source
      .getRepository(PasswordResetToken)
      .findOneBy({ tokenHash: hash });
    if (!candidate) throw this.invalidToken();
    // Expensive hashing holds no row lock. State is authoritative only after lock.
    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });
    await this.source.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const user = await users.findOne({
        where: { id: candidate.userId },
        lock: { mode: 'pessimistic_write' },
      });
      const tokens = manager.getRepository(PasswordResetToken);
      const token = await tokens.findOneBy({ userId: candidate.userId });
      const now = new Date();
      if (
        !user?.emailVerifiedAt ||
        !token ||
        token.tokenHash !== hash ||
        token.consumedAt ||
        token.expiresAt <= now
      )
        throw this.invalidToken();
      if (
        user.passwordHash &&
        (await argon2.verify(user.passwordHash, newPassword))
      )
        throw this.reusedPassword();
      await users.update(user.id, {
        passwordHash,
        authVersion: user.authVersion + 1,
      });
      await tokens.update(token.id, { consumedAt: now });
    });
  }

  async change(
    userId: string,
    expectedVersion: number,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const snapshot = await this.source
      .getRepository(User)
      .findOneBy({ id: userId });
    if (!snapshot?.emailVerifiedAt || snapshot.authVersion !== expectedVersion)
      throw new ApplicationException(
        401,
        ErrorCode.UNAUTHORIZED,
        'Unauthorized',
      );
    if (!snapshot.passwordHash)
      throw new ApplicationException(
        403,
        ErrorCode.PASSWORD_RECOVERY_REQUIRED,
        'Set a password using a recovery link sent to your verified email.',
      );
    if (!(await argon2.verify(snapshot.passwordHash, currentPassword)))
      throw new ApplicationException(
        403,
        ErrorCode.CURRENT_PASSWORD_INCORRECT,
        'Could not confirm your current password.',
        ['currentPassword: Could not confirm your current password.'],
      );
    if (await argon2.verify(snapshot.passwordHash, newPassword))
      throw this.reusedPassword();
    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });
    await this.source.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const user = await users.findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !user?.emailVerifiedAt ||
        user.authVersion !== expectedVersion ||
        user.passwordHash !== snapshot.passwordHash
      )
        throw new ApplicationException(
          401,
          ErrorCode.UNAUTHORIZED,
          'Your credentials changed. Log in again.',
        );
      await users.update(user.id, {
        passwordHash,
        authVersion: user.authVersion + 1,
      });
      await manager
        .getRepository(PasswordResetToken)
        .update({ userId, consumedAt: IsNull() }, { consumedAt: new Date() });
    });
  }

  private invalidToken(): ApplicationException {
    return new ApplicationException(
      400,
      ErrorCode.INVALID_PASSWORD_RESET_TOKEN,
      'This recovery link is invalid or expired. Request a new link.',
    );
  }
  private reusedPassword(): ApplicationException {
    return new ApplicationException(
      400,
      ErrorCode.PASSWORD_REUSED,
      'Choose a password different from your current password.',
      ['newPassword: Choose a password different from your current password.'],
    );
  }
}
