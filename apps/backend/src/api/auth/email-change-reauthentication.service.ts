import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { GoogleTokenVerifier } from './google-token-verifier.service';
import { GoogleIdentity } from './entities/google-identity.entity';
import { User } from '../users/entities/user.entity';
import type { AuthenticatedUser } from './constants/auth.constants';
import { RequestEmailChangeDto } from './dto/email-change.dto';
import { ApplicationException } from '../../exceptions/application.exception';
import { ErrorCode } from '../../common/dto/api-error';

/** Server-only proof snapshot. Never serialize this object or retain raw credentials. */
export interface EmailChangeProof extends AuthenticatedUser {
  email: string;
  passwordHash?: string;
  googleSub?: string;
}
export const EMAIL_CHANGE_GOOGLE_MAX_AGE_SECONDS = 300;
@Injectable()
export class EmailChangeReauthenticationService {
  constructor(
    private readonly source: DataSource,
    private readonly auth: AuthService,
    private readonly google: GoogleTokenVerifier,
  ) {}
  async verify(
    identity: AuthenticatedUser,
    input: Pick<RequestEmailChangeDto, 'currentPassword' | 'googleCredential'>,
  ): Promise<EmailChangeProof> {
    if (
      (input.currentPassword !== undefined) ===
      (input.googleCredential !== undefined)
    )
      throw new ApplicationException(
        400,
        ErrorCode.VALIDATION_FAILED,
        'Provide exactly one reauthentication method',
      );
    let user: User;
    let method: Pick<EmailChangeProof, 'passwordHash' | 'googleSub'>;
    if (input.currentPassword !== undefined) {
      try {
        user = await this.auth.reauthenticate(
          identity.userId,
          input.currentPassword,
        );
      } catch (error) {
        if (error instanceof ApplicationException && error.getStatus() === 401)
          throw invalidReauthentication();
        throw error;
      }
      method = { passwordHash: user.passwordHash! };
    } else {
      const linked = await this.source
        .getRepository(GoogleIdentity)
        .findOneBy({ userId: identity.userId });
      if (!linked) throw invalidReauthentication();
      const profile = await this.google.verify(
        input.googleCredential!,
        EMAIL_CHANGE_GOOGLE_MAX_AGE_SECONDS,
      );
      if (profile.sub !== linked.googleSub) throw invalidReauthentication();
      const snapshot = await this.source
        .getRepository(User)
        .findOneBy({ id: identity.userId });
      if (!snapshot) throw invalidReauthentication();
      user = snapshot;
      method = { googleSub: linked.googleSub };
    }
    if (
      user.deletedAt ||
      !user.emailVerifiedAt ||
      user.authVersion !== identity.authVersion ||
      identity.expiresAt <= Date.now()
    )
      throw new ApplicationException(
        401,
        ErrorCode.UNAUTHORIZED,
        'Unauthorized',
      );
    return { ...identity, email: user.email, ...method };
  }
}
export function invalidReauthentication(): ApplicationException {
  return new ApplicationException(
    403,
    ErrorCode.INVALID_CREDENTIALS,
    'Could not verify your current identity. Please authenticate again.',
  );
}
