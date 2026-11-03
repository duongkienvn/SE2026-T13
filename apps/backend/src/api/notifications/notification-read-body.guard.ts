import {
  BadRequestException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

@Injectable()
export class NotificationReadBodyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const body: unknown = context
      .switchToHttp()
      .getRequest<{ body: unknown }>().body;
    if (
      body === undefined ||
      (body !== null &&
        typeof body === 'object' &&
        !Array.isArray(body) &&
        !Object.keys(body).length)
    )
      return true;
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message:
        'Read-state commands accept no fields; readAt and recipient identity are server-owned',
    });
  }
}
