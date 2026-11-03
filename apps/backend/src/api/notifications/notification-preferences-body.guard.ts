import {
  BadRequestException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import {
  EMAIL_PREFERENCE_COLUMNS,
  IN_APP_PREFERENCE_COLUMNS,
} from './notification-preferences';

@Injectable()
export class NotificationPreferencesBodyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const body: unknown = context
      .switchToHttp()
      .getRequest<{ body: unknown }>().body;
    const object = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value);
    let leaves = 0;
    const invalid = () =>
      new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: [
          'Provide at least one known notification preference boolean; null, unknown fields and non-object bodies are invalid',
        ],
      });
    if (!object(body)) throw invalid();
    for (const [channel, values] of Object.entries(body)) {
      if ((channel !== 'inApp' && channel !== 'email') || !object(values))
        throw invalid();
      const allowed =
        channel === 'inApp'
          ? IN_APP_PREFERENCE_COLUMNS
          : EMAIL_PREFERENCE_COLUMNS;
      for (const [key, value] of Object.entries(values)) {
        if (!Object.hasOwn(allowed, key) || typeof value !== 'boolean')
          throw invalid();
        leaves++;
      }
    }
    if (!leaves) throw invalid();
    return true;
  }
}
