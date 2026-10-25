import {
  BadRequestException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ErrorCode } from '../../common/dto/api-error';
import { DEFAULT_USER_PREFERENCES } from './user-preferences.constants';

@Injectable()
export class UserPreferencesBodyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const body = context.switchToHttp().getRequest<{ body: unknown }>().body;
    // Check raw keys before the validation pipe strips prototype-related keys.
    const unknownKeys =
      body !== null && typeof body === 'object'
        ? Object.keys(body).filter(
            (key) => !Object.hasOwn(DEFAULT_USER_PREFERENCES, key),
          )
        : [];
    if (unknownKeys.length > 0) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Validation failed',
        details: unknownKeys.map(
          (key) => `${key}: property ${key} should not exist`,
        ),
      });
    }
    return true;
  }
}
