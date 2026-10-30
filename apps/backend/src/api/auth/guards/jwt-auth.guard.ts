import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApplicationException } from '../../../exceptions/application.exception';
import { ErrorCode } from '../../../common/dto/api-error';
import type { AuthenticatedUser } from '../constants/auth.constants';
import { AuthService } from '../auth.service';

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  /** Only the error status varies; JWT, session and verification checks remain mandatory. */
  protected readonly unverifiedStatus: 401 | 403 = 401;
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.readBearerToken(request.headers.authorization);
    request.user = await this.authService.authenticateAccessToken(
      token,
      this.unverifiedStatus,
    );
    return true;
  }

  private readBearerToken(authorization: string | undefined): string {
    if (!authorization?.startsWith('Bearer ')) {
      throw this.unauthorized();
    }
    const token = authorization.slice('Bearer '.length).trim();
    if (!token || token.includes(' ')) throw this.unauthorized();
    return token;
  }

  private unauthorized(): ApplicationException {
    return new ApplicationException(
      401,
      ErrorCode.UNAUTHORIZED,
      'Unauthorized',
    );
  }
}
