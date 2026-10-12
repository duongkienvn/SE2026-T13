import { HttpStatus, Type, applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  ApiErrorResponseDto,
  ApiSuccessEnvelopeDto,
  CursorPaginationMetaDto,
  PaginationMetaDto,
} from '../common/dto/api-response.dto';

interface DocumentedResponseOptions<T extends Type<unknown>> {
  type: T;
  status?: HttpStatus.OK | HttpStatus.CREATED | HttpStatus.NO_CONTENT;
  summary?: string;
  description?: string;
}

export function ApiSuccess<T extends Type<unknown>>(
  options: DocumentedResponseOptions<T>,
): MethodDecorator {
  const status = options.status ?? HttpStatus.OK;
  return applyDecorators(
    ApiExtraModels(ApiSuccessEnvelopeDto, options.type),
    ApiOperation({
      summary: options.summary,
      description: options.description,
    }),
    ApiResponse({
      status,
      description: options.description,
      ...(status === HttpStatus.NO_CONTENT
        ? {}
        : {
            schema: {
              allOf: [
                { $ref: getSchemaPath(ApiSuccessEnvelopeDto) },
                { properties: { data: { $ref: getSchemaPath(options.type) } } },
              ],
            },
          }),
    }),
  );
}

export function ApiPaginated<T extends Type<unknown>>(
  type: T,
  options: { summary?: string; description?: string; cursor?: boolean } = {},
): MethodDecorator {
  const meta = options.cursor ? CursorPaginationMetaDto : PaginationMetaDto;
  return applyDecorators(
    ApiExtraModels(ApiSuccessEnvelopeDto, type, meta),
    ApiOperation({
      summary: options.summary,
      description: options.description,
    }),
    ApiResponse({
      status: HttpStatus.OK,
      description: options.description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiSuccessEnvelopeDto) },
          {
            properties: {
              data: { type: 'array', items: { $ref: getSchemaPath(type) } },
              meta: { $ref: getSchemaPath(meta) },
            },
            required: ['meta'],
          },
        ],
      },
    }),
  );
}

export function ApiNoContent(
  options: { summary?: string; description?: string } = {},
): MethodDecorator {
  return applyDecorators(
    ApiOperation(options),
    ApiResponse({
      status: HttpStatus.NO_CONTENT,
      description: options.description,
    }),
  );
}

export function ApiCommonErrors(
  statuses: number[] = [400, 401, 403, 404, 409, 429, 500],
): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ApiErrorResponseDto),
    ...statuses.map((status) =>
      ApiResponse({ status, type: ApiErrorResponseDto }),
    ),
  );
}

export const ApiBearerToken = (): MethodDecorator => ApiBearerAuth();
