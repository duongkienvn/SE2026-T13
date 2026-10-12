import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { ApiError, ErrorCode } from '../common/dto/api-error';

interface ErrorWithCode {
  code?: string;
}

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return ErrorCode.BAD_REQUEST;
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    default:
      return status >= 500 ? ErrorCode.INTERNAL_ERROR : 'HTTP_ERROR';
  }
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL_ERROR;
    let message = 'Internal server error';
    let details: string[] | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      code = codeForStatus(statusCode);
      const body: unknown = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const payload = body as Record<string, unknown>;
        if (typeof payload.code === 'string') code = payload.code;
        if (typeof payload.message === 'string') message = payload.message;
        if (Array.isArray(payload.details)) {
          details = payload.details.filter(
            (item): item is string => typeof item === 'string',
          );
        }
        if (Array.isArray(payload.message)) {
          message = 'Validation failed';
          details = payload.message.filter(
            (item): item is string => typeof item === 'string',
          );
          code = ErrorCode.VALIDATION_FAILED;
        }
      }
      if (statusCode >= 500) {
        message = 'Internal server error';
        code = ErrorCode.INTERNAL_ERROR;
        details = undefined;
      }
    } else if (exception instanceof EntityNotFoundError) {
      statusCode = HttpStatus.NOT_FOUND;
      code = ErrorCode.NOT_FOUND;
      message = 'Resource not found';
    } else if (exception instanceof QueryFailedError) {
      const sqlState = (exception.driverError as ErrorWithCode | undefined)
        ?.code;
      if (sqlState === '23505' || sqlState === '23503') {
        statusCode = HttpStatus.CONFLICT;
        code = ErrorCode.CONFLICT;
        message = 'Database constraint conflict';
      }
    }

    const requestId = typeof request.id === 'string' ? request.id : undefined;
    if (statusCode >= 500) {
      const exceptionType =
        exception instanceof Error ? exception.name : typeof exception;
      this.logger.error(
        { requestId, exceptionType, context: GlobalExceptionFilter.name },
        'Unhandled request error',
      );
    }
    const body: ApiError = {
      statusCode,
      code,
      message,
      timestamp: new Date().toISOString(),
      path: request.path,
      ...(details ? { details } : {}),
      ...(requestId ? { requestId } : {}),
    };
    response.status(statusCode).json(body);
  }
}
