import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import type { Response } from 'express';
import {
  ApiOkResponse,
  ApiProduces,
  ApiHeader,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiNoContent,
  ApiPaginated,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import {
  SkipResponseWrap,
  SerializeResponse,
} from '../../decorators/response.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CardAttachmentsService } from './card-attachments.service';
import { CardAttachmentFilesService } from './card-attachment-files.service';
import { attachmentDisposition } from './attachments/attachment-file-policy';
import { AttachmentResponseDto } from './dto/attachment-response.dto';
import {
  AttachmentListQueryDto,
  AttachmentReadQueryDto,
  CreateAttachmentDto,
  DeleteAttachmentQueryDto,
  UpdateAttachmentDto,
} from './dto/attachment-requests.dto';

@ApiTags('card-attachments')
@ApiParam({ name: 'boardId', format: 'uuid' })
@ApiParam({ name: 'cardId', format: 'uuid' })
@Controller('boards/:boardId/cards/:cardId/attachments')
@UseGuards(JwtAuthGuard)
export class CardAttachmentsController {
  constructor(
    private readonly attachments: CardAttachmentsService,
    private readonly files: CardAttachmentFilesService,
  ) {}

  @Get()
  @ApiBearerToken()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(AttachmentResponseDto)
  @ApiPaginated(AttachmentResponseDto, {
    summary: 'List ACTIVE attachment metadata; createdAt DESC, id DESC',
  })
  @ApiCommonErrors()
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    schema: { minimum: 1, default: 1 },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    schema: { minimum: 1, maximum: 100, default: 20 },
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Query() query: AttachmentListQueryDto,
  ) {
    return this.attachments.list(user.userId, boardId, cardId, query);
  }

  @Post()
  @ApiBearerToken()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(AttachmentResponseDto)
  @ApiSuccess({
    type: AttachmentResponseDto,
    status: 201,
    summary: 'Create HTTPS metadata; files use the upload-intent endpoint',
    description:
      'Provisional 20 ACTIVE/PENDING slots per Card. Optional UUID v4 Idempotency-Key replays return current metadata without another mutation/event.',
  })
  @ApiCommonErrors([400, 401, 403, 404, 409, 429, 500, 503])
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() input: CreateAttachmentDto,
    @Headers('Idempotency-Key') key?: string,
    @Headers('x-kanvexa-operation-id') operationId?: string,
  ) {
    return this.attachments.create(
      user.userId,
      boardId,
      cardId,
      input,
      key,
      operationId,
    );
  }

  @Get(':attachmentId')
  @ApiBearerToken()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(AttachmentResponseDto)
  @ApiSuccess({
    type: AttachmentResponseDto,
    summary: 'Read ACTIVE metadata; pending and removed attachments are hidden',
  })
  @ApiCommonErrors()
  @ApiParam({ name: 'attachmentId', format: 'uuid' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('attachmentId', ParseUUIDPipe) id: string,
    @Query() query: AttachmentReadQueryDto,
  ) {
    void query;
    return this.attachments.get(user.userId, boardId, cardId, id);
  }

  @Patch(':attachmentId')
  @ApiBearerToken()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(AttachmentResponseDto)
  @ApiSuccess({
    type: AttachmentResponseDto,
    summary:
      'Edit URL/display metadata with expectedRevision; effective no-ops do not advance it',
  })
  @ApiCommonErrors([400, 401, 403, 404, 409, 429, 500, 503])
  @ApiParam({ name: 'attachmentId', format: 'uuid' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('attachmentId', ParseUUIDPipe) id: string,
    @Body() input: UpdateAttachmentDto,
    @Headers('x-kanvexa-operation-id') operationId?: string,
  ) {
    return this.attachments.update(
      user.userId,
      boardId,
      cardId,
      id,
      input,
      operationId,
    );
  }

  @Delete(':attachmentId')
  @ApiBearerToken()
  @HttpCode(204)
  @ApiNoContent({
    summary: 'Remove URL attachment; authorized repeat removal returns 204',
  })
  @ApiCommonErrors([400, 401, 403, 404, 409, 429, 500, 503])
  @ApiParam({ name: 'attachmentId', format: 'uuid' })
  @ApiQuery({
    name: 'expectedRevision',
    required: false,
    type: Number,
    schema: { minimum: 1 },
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('attachmentId', ParseUUIDPipe) id: string,
    @Query() query: DeleteAttachmentQueryDto,
    @Headers('x-kanvexa-operation-id') operationId?: string,
  ) {
    return this.attachments.remove(
      user.userId,
      boardId,
      cardId,
      id,
      query.expectedRevision,
      operationId,
    );
  }

  @Get(':attachmentId/file')
  @ApiBearerToken()
  @Header('Cache-Control', 'private, no-store')
  @SkipResponseWrap()
  @ApiProduces(
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/pdf',
    'text/plain',
  )
  @ApiOkResponse({
    description: 'Authenticated verified file bytes',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiCommonErrors([400, 401, 403, 404, 413, 429, 503])
  @ApiParam({ name: 'attachmentId', format: 'uuid' })
  async file(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('attachmentId', ParseUUIDPipe) id: string,
    @Query() query: AttachmentReadQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    void query;
    const { object, metadata } = await this.files.download(
      user,
      boardId,
      cardId,
      id,
    );
    response.set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type':
        metadata.mimeType === 'text/plain'
          ? 'text/plain; charset=utf-8'
          : metadata.mimeType!,
      'Content-Length': String(metadata.byteSize),
      'Content-Disposition': attachmentDisposition(
        metadata.originalFilename!,
        metadata.mimeType!,
      ),
      'Content-Security-Policy':
        "sandbox; default-src 'none'; frame-ancestors 'none'",
    });
    const stream = Readable.from(object.body);
    response.once('close', () => {
      stream.destroy();
      object.cancel?.();
    });
    return new StreamableFile(stream);
  }
}
