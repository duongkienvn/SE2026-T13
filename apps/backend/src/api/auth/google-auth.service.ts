import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { ErrorCode } from '../../common/dto/api-error';
import { ApplicationException } from '../../exceptions/application.exception';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { GoogleIdentity } from './entities/google-identity.entity';
import { GoogleTokenVerifier } from './google-token-verifier.service';
import { LoginResponseDto } from './dto/login-response.dto';
import { LinkedProvidersDto } from './dto/linked-providers.dto';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { WelcomeOnboardingService } from './welcome-onboarding.service';

@Injectable()
export class GoogleAuthService {
  constructor(
    private readonly source: DataSource,
    private readonly verifier: GoogleTokenVerifier,
    private readonly auth: AuthService,
    private readonly verification: EmailVerificationService,
    private readonly workspaces: WorkspacesService,
    private readonly welcome: WelcomeOnboardingService,
  ) {}

  async signIn(credential: string): Promise<LoginResponseDto> {
    const profile = await this.verifier.verify(credential);
    const { user, created } = await this.transaction(async (manager) => {
      await this.lock(manager, `google-sub:${profile.sub}`);
      const identities = manager.getRepository(GoogleIdentity);
      const users = manager.getRepository(User);
      const identity = await identities.findOneBy({ googleSub: profile.sub });
      if (identity) {
        // Email/name/avatar changes at Google cannot change ownership or profile.
        return {
          user: await users.findOneByOrFail({ id: identity.userId }),
          created: false,
        };
      }
      await this.lock(manager, `google-email:${profile.email}`);
      if (await users.existsBy({ email: profile.email })) {
        throw new ApplicationException(
          409,
          ErrorCode.ACCOUNT_LINK_REQUIRED,
          'An account already uses this email. Log in with your password, then connect Google in Profile.',
        );
      }
      const user = await users.save(
        users.create({
          email: profile.email,
          passwordHash: null,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          emailVerifiedAt: profile.authoritativeEmail ? new Date() : null,
        }),
      );
      await identities.save(
        identities.create({ userId: user.id, googleSub: profile.sub }),
      );
      await this.workspaces.ensurePersonalWorkspace(user.id, manager);
      await this.welcome.enroll(manager, user);
      return { user, created: true };
    });
    if (created && user.emailVerifiedAt)
      await this.welcome.deliverPending(user.id);
    // Reuse K2 token lifecycle, cooldown and delivery failure handling after commit.
    if (!user.emailVerifiedAt)
      await this.verification.send(user.email, created);
    return this.auth.issueLoginResponse(user);
  }

  async linkedProviders(userId: string): Promise<LinkedProvidersDto> {
    const user = await this.source
      .getRepository(User)
      .findOneBy({ id: userId });
    if (!user?.emailVerifiedAt)
      throw new ApplicationException(
        401,
        ErrorCode.UNAUTHORIZED,
        'Unauthorized',
      );
    return {
      googleLinked: await this.source
        .getRepository(GoogleIdentity)
        .existsBy({ userId }),
      hasPassword: user.passwordHash !== null,
    };
  }

  async link(
    userId: string,
    credential: string,
    password: string,
  ): Promise<void> {
    let reauthenticated: User;
    try {
      reauthenticated = await this.auth.reauthenticate(userId, password);
    } catch (error) {
      if (error instanceof ApplicationException && error.getStatus() === 401)
        // A wrong reauthentication password does not invalidate the current JWT.
        throw new ApplicationException(
          403,
          ErrorCode.INVALID_CREDENTIALS,
          'Could not confirm your current password.',
        );
      throw error;
    }
    const profile = await this.verifier.verify(credential);
    await this.transaction(async (manager) => {
      await this.lock(manager, `google-sub:${profile.sub}`);
      const user = await manager.getRepository(User).findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !user?.passwordHash ||
        !user.emailVerifiedAt ||
        user.passwordHash !== reauthenticated.passwordHash
      )
        throw new ApplicationException(
          403,
          ErrorCode.INVALID_CREDENTIALS,
          'Please confirm your current password again.',
        );
      if (user.email.trim().toLowerCase() !== profile.email)
        throw this.conflict();
      const identities = manager.getRepository(GoogleIdentity);
      const bySubject = await identities.findOneBy({ googleSub: profile.sub });
      if (bySubject && bySubject.userId !== userId) throw this.conflict();
      const byUser = await identities.findOneBy({ userId });
      if (byUser && byUser.googleSub !== profile.sub) throw this.conflict();
      if (bySubject) return; // Same verified proof is idempotent; no session rotation.
      await identities.save(
        identities.create({ userId, googleSub: profile.sub }),
      );
    });
  }

  private async lock(manager: EntityManager, key: string): Promise<void> {
    // Transaction-scoped and shared across processes; hash collisions only serialize.
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [key],
    );
  }

  private async transaction<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.source.transaction(work);
      } catch (error) {
        if (!(error instanceof QueryFailedError)) throw error;
        const driver = error.driverError as { code?: string };
        if (!['23505', '40001', '40P01'].includes(driver.code ?? ''))
          throw error;
        // A local registration can race our email check. Retry from a fresh
        // transaction, re-read state and return the same stable business outcome.
        if (attempt === 0) continue;
        throw this.conflict();
      }
    }
  }

  private conflict(): ApplicationException {
    return new ApplicationException(
      409,
      ErrorCode.GOOGLE_ACCOUNT_CONFLICT,
      'Google could not be connected. Use the same verified email and an account that is not already connected elsewhere.',
    );
  }
}
