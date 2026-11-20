import {
  BadRequestException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
@Injectable()
export class PushRequestGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const { body, method } = context
      .switchToHttp()
      .getRequest<{ body: unknown; method: string }>();
    if (method === 'POST' || method === 'PATCH') {
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new BadRequestException('A push settings object is required');
    } else if (
      body !== undefined &&
      body !== null &&
      (typeof body !== 'object' || Object.keys(body).length)
    ) {
      throw new BadRequestException('This push operation is bodyless');
    }
    return true;
  }
}
