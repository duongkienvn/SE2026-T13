import {
  Body,
  CanActivate,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Injectable,
  NestInterceptor,
  CallHandler,
  ExecutionContext,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiProduces,
} from '@nestjs/swagger';
import { catchError } from 'rxjs';
import type { Response } from 'express';
import {
  ApiSuccess,
  ApiCommonErrors,
  ApiNoContent,
} from '../../../decorators/swagger-response.decorators';
import {
  SerializeResponse,
  SkipResponseWrap,
} from '../../../decorators/response.decorators';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/constants/auth.constants';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserResponseDto } from '../dto/user-response.dto';
import { AVATAR_MAX_BYTES, avatarError } from './avatar.constants';
import {
  AvatarRevisionDto,
  AvatarUploadRequestDto,
  AvatarUploadResponseDto,
} from './avatar.dto';
import { AvatarService } from './avatar.service';
import { AvatarStorage } from './avatar-storage';

@Injectable()
export class LocalAvatarUploadGuard implements CanActivate {
  constructor(private readonly storage: AvatarStorage) {}
  canActivate(): boolean {
    if (this.storage.kind !== 'memory')
      throw avatarError(404, 'NOT_FOUND', 'Endpoint not found.');
    return true;
  }
}

@Injectable()
export class AvatarMultipartErrors implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpException && error.getStatus() === 413)
          throw avatarError(
            413,
            'AVATAR_TOO_LARGE',
            'Choose a photo no larger than 5 MiB.',
          );
        throw error;
      }),
    );
  }
}

@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AvatarController {
  constructor(private readonly avatars: AvatarService) {}

  @Post('me/avatar/uploads')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @SerializeResponse(AvatarUploadResponseDto)
  @ApiSuccess({
    type: AvatarUploadResponseDto,
    status: 201,
    summary: 'Request a private avatar upload',
  })
  @ApiCommonErrors([400, 401, 404, 409, 429, 503])
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: AvatarUploadRequestDto,
  ) {
    return this.avatars.createIntent(user.userId, input);
  }

  @Post('me/avatar/uploads/:uploadId/complete')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SerializeResponse(UserResponseDto)
  @ApiSuccess({
    type: UserResponseDto,
    summary: 'Verify and commit an uploaded avatar',
  })
  @ApiCommonErrors([400, 401, 404, 409, 413, 415, 422, 429, 503])
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('uploadId', ParseUUIDPipe) id: string,
  ) {
    return this.avatars.complete(user.userId, id);
  }

  @Delete('me/avatar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SerializeResponse(UserResponseDto)
  @ApiSuccess({ type: UserResponseDto, summary: 'Remove the current avatar' })
  @ApiCommonErrors([400, 401, 404, 409, 429, 500])
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: AvatarRevisionDto,
  ) {
    return this.avatars.remove(user.userId, input.expectedRevision);
  }

  @Post('me/avatar/uploads/:uploadId/file')
  @HttpCode(204)
  @UseGuards(LocalAvatarUploadGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @UseInterceptors(
    AvatarMultipartErrors,
    FileInterceptor('file', {
      limits: { fileSize: AVATAR_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiNoContent({ summary: 'Transfer a photo in development memory mode only' })
  @ApiCommonErrors([400, 401, 404, 409, 413, 415, 429])
  async localFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('uploadId', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file)
      throw avatarError(400, 'AVATAR_FILE_REQUIRED', 'Choose a photo.');
    await this.avatars.receiveLocal(
      user.userId,
      id,
      file.buffer,
      file.mimetype,
    );
  }

  @Get(':userId/avatar/:assetId')
  @SkipResponseWrap()
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @ApiProduces('image/webp')
  @ApiOkResponse({
    description: 'Authorized private avatar bytes',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiCommonErrors([400, 401, 404, 429, 503])
  async image(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const body = await this.avatars.read(viewer.userId, userId, assetId);
    response.set({
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline; filename="avatar.webp"',
    });
    return new StreamableFile(body);
  }
}
