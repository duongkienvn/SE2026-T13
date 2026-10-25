import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../constants/auth.constants';
import { ApplicationException } from '../../../exceptions/application.exception';
import { ErrorCode } from '../../../common/dto/api-error';

/** Additional account bucket after JwtAuthGuard; global guard still limits IP. */
@Injectable()
export class PasswordChangeThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(request: {
    user?: AuthenticatedUser;
  }): Promise<string> {
    if (!request.user)
      throw new ApplicationException(
        401,
        ErrorCode.UNAUTHORIZED,
        'Unauthorized',
      );
    return `password-change/user/${request.user.userId}`;
  }
}
