import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { REDIRECT_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { ClassConstructor } from 'class-transformer';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { map, Observable } from 'rxjs';
import { isExplicitApiSuccess } from '../common/dto/api-success';
import { CURSOR_RESULT, CursorResult } from '../common/dto/cursor-result';
import {
  PAGINATED_RESULT,
  PaginatedResponse,
} from '../common/dto/paginated-response';
import { toResponseDto } from '../common/dto/to-response-dto';
import {
  RESPONSE_DTO,
  RESPONSE_MESSAGE,
  SKIP_RESPONSE_WRAP,
} from '../decorators/response.decorators';

function isPageResult(value: unknown): value is PaginatedResponse<unknown> {
  return (
    typeof value === 'object' && value !== null && PAGINATED_RESULT in value
  );
}

function isCursorResult(value: unknown): value is CursorResult<unknown> {
  return typeof value === 'object' && value !== null && CURSOR_RESULT in value;
}

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const handler = context.getHandler();
    const controller = context.getClass();
    if (
      this.reflector.getAllAndOverride<boolean>(SKIP_RESPONSE_WRAP, [
        handler,
        controller,
      ])
    ) {
      return next.handle();
    }
    if (this.reflector.get(REDIRECT_METADATA, handler)) return next.handle();
    const response = context.switchToHttp().getResponse<Response>();
    const customMessage = this.reflector.getAllAndOverride<string>(
      RESPONSE_MESSAGE,
      [handler, controller],
    );
    const responseDto = this.reflector.getAllAndOverride<
      ClassConstructor<object>
    >(RESPONSE_DTO, [handler, controller]);
    return next.handle().pipe(
      map((value: unknown) => {
        const statusCode = response.statusCode;
        if (
          value === undefined ||
          statusCode === 204 ||
          (statusCode >= 300 && statusCode < 400) ||
          response.headersSent ||
          value instanceof StreamableFile ||
          value instanceof Readable ||
          Buffer.isBuffer(value) ||
          isExplicitApiSuccess(value)
        )
          return value;

        const message =
          customMessage ?? (statusCode === 201 ? 'Created' : 'OK');
        if (isPageResult(value)) {
          return {
            success: true,
            statusCode,
            message,
            data: responseDto
              ? value.data.map((item) => toResponseDto(responseDto, item))
              : value.data,
            meta: value.meta,
          };
        }
        if (isCursorResult(value)) {
          return {
            success: true,
            statusCode,
            message,
            data: responseDto
              ? value.data.map((item) => toResponseDto(responseDto, item))
              : value.data,
            meta: value.meta,
          };
        }
        const data = responseDto
          ? Array.isArray(value)
            ? value.map((item) => toResponseDto(responseDto, item))
            : toResponseDto(responseDto, value)
          : value;
        return { success: true, statusCode, message, data };
      }),
    );
  }
}
