import {
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Header,
  Headers,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiNoContent,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CardAttachmentFilesService } from './card-attachment-files.service';
import {
  CreateAttachmentUploadDto,
  AttachmentUploadResponseDto,
  AttachmentUploadEmptyDto,
} from './dto/attachment-upload.dto';
import { AttachmentResponseDto } from './dto/attachment-response.dto';
import {
  ATTACHMENT_FILE_POLICY as POLICY,
  fileError,
} from './attachments/attachment-file-policy';

@Injectable()
export class LocalAttachmentUploadGuard implements CanActivate {
  constructor(private readonly files: CardAttachmentFilesService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{
        user: AuthenticatedUser;
        params: Record<string, string>;
      }>();
    for (const field of ['boardId', 'cardId', 'uploadId'])
      if (!isUUID(request.params[field]))
        throw fileError(400, 'VALIDATION_FAILED', 'Invalid resource ID');
    await this.files.checkLocalUpload(
      request.user,
      request.params.boardId,
      request.params.cardId,
      request.params.uploadId,
    );
    return true;
  }
}
@ApiTags('card-attachments')
@ApiParam({ name: 'boardId', format: 'uuid' })
@ApiParam({ name: 'cardId', format: 'uuid' })
@Controller('boards/:boardId/cards/:cardId/attachments/uploads')
@UseGuards(JwtAuthGuard)
export class CardAttachmentUploadsController {
  constructor(private readonly files: CardAttachmentFilesService) {}
  @Post()
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @ApiBearerToken()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @SerializeResponse(AttachmentUploadResponseDto)
  @ApiSuccess({
    type: AttachmentUploadResponseDto,
    status: 201,
    summary:
      'Reserve owned private file upload; no file is public before completion',
    description:
      'V1: 10 MiB/file, 20 slots/Card, 100 MiB active/pending Board bytes. Images reserve 10 MiB pending normalization budget. Reuse Idempotency-Key; grants expire within 60 seconds.',
  })
  @ApiCommonErrors([400, 401, 403, 404, 409, 413, 415, 429, 503])
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() input: CreateAttachmentUploadDto,
    @Headers('Idempotency-Key') key?: string,
  ) {
    return this.files.createIntent(actor, boardId, cardId, input, key);
  }

  @Post(':uploadId/complete')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @ApiBearerToken()
  @ApiParam({ name: 'uploadId', format: 'uuid' })
  @SerializeResponse(AttachmentResponseDto)
  @ApiSuccess({
    type: AttachmentResponseDto,
    summary:
      'Verify actual private bytes and atomically activate attachment; owner-only and retry-safe',
  })
  @ApiCommonErrors([400, 401, 403, 404, 409, 413, 415, 422, 429, 503])
  complete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('uploadId', ParseUUIDPipe) id: string,
    @Body() input: AttachmentUploadEmptyDto,
    @Query() query: AttachmentUploadEmptyDto,
  ) {
    void input;
    void query;
    return this.files.complete(actor, boardId, cardId, id);
  }

  @Delete(':uploadId')
  @HttpCode(204)
  @ApiBearerToken()
  @ApiParam({ name: 'uploadId', format: 'uuid' })
  @ApiNoContent({
    summary:
      'Cancel an owned unfinished intent; repeat cancellation is 204; no public Card event',
  })
  @ApiCommonErrors([400, 401, 403, 404, 409, 429, 503])
  cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('uploadId', ParseUUIDPipe) id: string,
    @Query() query: AttachmentUploadEmptyDto,
  ) {
    void query;
    return this.files.cancel(actor, boardId, cardId, id);
  }

  @Post(':uploadId/file')
  @HttpCode(204)
  @UseGuards(LocalAttachmentUploadGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: POLICY.maximumFileBytes,
        files: 1,
        fields: 0,
        parts: 1,
      },
    }),
  )
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @ApiBearerToken()
  @ApiParam({ name: 'uploadId', format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiNoContent({
    summary:
      'Development/test memory transfer only; ownership/ACL checked before multipart parsing',
  })
  @ApiCommonErrors([400, 401, 403, 404, 409, 413, 415, 429, 503])
  async local(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('uploadId', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file)
      throw fileError(400, 'ATTACHMENT_FILE_REQUIRED', 'A file is required');
    await this.files.receiveLocal(
      actor,
      boardId,
      cardId,
      id,
      file.buffer,
      file.mimetype,
    );
  }
}
