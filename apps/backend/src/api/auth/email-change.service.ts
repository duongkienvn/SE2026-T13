import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { EnvironmentConfig } from '../../config/environment';
import { ApplicationException } from '../../exceptions/application.exception';
import { ErrorCode } from '../../common/dto/api-error';
import { EmailChangeMailer } from '../../mail/email-change-mailer';
import { User } from '../users/entities/user.entity';
import { GoogleIdentity } from './entities/google-identity.entity';
import { PendingEmailChange } from './entities/pending-email-change.entity';
import type { AuthenticatedUser } from './constants/auth.constants';
import {
  EmailChangeProof,
  invalidReauthentication,
} from './email-change-reauthentication.service';
import { PendingEmailChangeDto } from './dto/email-change.dto';
import { toResponseDto } from '../../common/dto/to-response-dto';

export const EMAIL_CHANGE_TTL_MS = 30 * 60_000;
export const EMAIL_CHANGE_COOLDOWN_MS = 60_000;
export const EMAIL_CHANGE_WINDOW_MS = 60 * 60_000;
export const EMAIL_CHANGE_MAX_ATTEMPTS = 5;
export const EMAIL_CHANGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const emailChangeHash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${Array.from(local)[0]}***@${Array.from(domain)[0]}***`;
}
@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name);
  constructor(
    private readonly source: DataSource,
    private readonly mailer: EmailChangeMailer,
    private readonly config: ConfigService<EnvironmentConfig, true>,
  ) {}

  /** Caller has already proven a fresh credential; no raw proof enters persistence. */
  async request(proof: EmailChangeProof, newEmail: string): Promise<void> {
    const issued = await this.source.transaction(async (manager) => {
      await this.boundTransaction(manager);
      const users = manager.getRepository(User);
      const user = await users.findOne({
        where: { id: proof.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !user?.emailVerifiedAt ||
        user.email !== proof.email ||
        user.authVersion !== proof.authVersion ||
        proof.expiresAt <= Date.now()
      )
        throw new ApplicationException(
          401,
          ErrorCode.UNAUTHORIZED,
          'Unauthorized',
        );
      if (proof.passwordHash !== undefined) {
        if (user.passwordHash !== proof.passwordHash)
          throw invalidReauthentication();
      } else if (proof.googleSub !== undefined) {
        if (
          !(await manager
            .getRepository(GoogleIdentity)
            .existsBy({ userId: user.id, googleSub: proof.googleSub }))
        )
          throw invalidReauthentication();
      } else throw invalidReauthentication();
      if (newEmail === user.email) return null;
      const tokens = manager.getRepository(PendingEmailChange);
      const previous = await tokens.findOne({
        where: { userId: user.id },
        lock: { mode: 'pessimistic_write' },
      });
      const now = await this.now(manager);
      if (
        previous &&
        now.getTime() - previous.createdAt.getTime() < EMAIL_CHANGE_COOLDOWN_MS
      )
        return null;
      const attempts = (previous?.issuanceAttempts ?? []).filter(
        (date) => date.getTime() > now.getTime() - EMAIL_CHANGE_WINDOW_MS,
      );
      if (attempts.length >= EMAIL_CHANGE_MAX_ATTEMPTS) return null;
      const deliverable = !(await users.existsBy({ email: newEmail }));
      const plaintext = randomBytes(32).toString('base64url');
      // Persist the same pending shape for occupied targets. Otherwise polling
      // pending would turn the generic request endpoint into an existence oracle.
      // No mail is ever sent to an occupied target, nor to its current owner.
      const token = await tokens.save(
        tokens.create({
          ...(previous ?? {}),
          userId: user.id,
          tokenHash: emailChangeHash(plaintext),
          newEmail,
          originalEmail: user.email,
          originalAuthVersion: user.authVersion,
          createdAt: now,
          expiresAt: new Date(now.getTime() + EMAIL_CHANGE_TTL_MS),
          consumedAt: null,
          sentAt: null,
          issuanceAttempts: [...attempts, now],
        }),
      );
      return deliverable ? { token, plaintext } : null;
    });
    if (!issued) return;
    const url = new URL(
      '/confirm-email-change',
      this.config.get('PUBLIC_APP_URL', { infer: true }),
    );
    url.searchParams.set('token', issued.plaintext);
    try {
      // No transaction, row lock or automatic resend spans provider I/O.
      await this.mailer.sendProof(
        issued.token.newEmail,
        url.toString(),
        `email-change/${issued.token.tokenHash}`,
      );
    } catch {
      this.logger.warn('Email change proof delivery unavailable');
      return; // Ambiguous sends retain a valid proof and charged rolling quota.
    }
    await this.source
      .getRepository(PendingEmailChange)
      .update(
        { userId: proof.userId, tokenHash: issued.token.tokenHash },
        { sentAt: new Date() },
      );
  }

  async pending(
    identity: AuthenticatedUser,
  ): Promise<PendingEmailChangeDto | null> {
    if (identity.expiresAt <= Date.now())
      throw new ApplicationException(
        401,
        ErrorCode.UNAUTHORIZED,
        'Unauthorized',
      );
    const token = await this.source
      .getRepository(PendingEmailChange)
      .createQueryBuilder('pending')
      .innerJoin('pending.user', 'user')
      .where('pending.userId = :userId', { userId: identity.userId })
      .andWhere(
        'user.authVersion = :version AND pending.originalAuthVersion = user.authVersion',
        { version: identity.authVersion },
      )
      .andWhere(
        'user.emailVerifiedAt IS NOT NULL AND pending.originalEmail = user.email',
      )
      .andWhere(
        'pending.consumedAt IS NULL AND pending.expiresAt > clock_timestamp()',
      )
      .getOne();
    return token
      ? toResponseDto(PendingEmailChangeDto, {
          maskedNewEmail: maskEmail(token.newEmail),
          issuedAt: token.createdAt.toISOString(),
          expiresAt: token.expiresAt.toISOString(),
        })
      : null;
  }
  private async boundTransaction(manager: EntityManager): Promise<void> {
    await manager.query("SET LOCAL lock_timeout = '2s'");
    await manager.query("SET LOCAL statement_timeout = '3s'");
  }
  private async now(manager: EntityManager): Promise<Date> {
    const [row]: { now: Date }[] = await manager.query(
      'SELECT clock_timestamp() AS now',
    );
    return row.now;
  }
}
