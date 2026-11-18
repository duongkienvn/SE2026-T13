import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
  Body,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiBearerToken,
  ApiCommonErrors,
} from '../../decorators/swagger-response.decorators';
import { SkipResponseWrap } from '../../decorators/response.decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { BoardExportQueryDto, AccountExportQueryDto } from './export-query.dto';
import { BoardExportService } from './board-export.service';
import { AccountExportService } from './account-export.service';
import { ExportSnapshot, snapshotAuthorization } from './export-snapshot';
import { ExportJobsService } from './export-jobs.service';

@Controller()
@UseGuards(JwtAuthGuard)
@SkipResponseWrap()
export class ExportsController {
  constructor(
    private readonly boards: BoardExportService,
    private readonly accounts: AccountExportService,
    private readonly snapshots: ExportSnapshot,
    private readonly jobs: ExportJobsService,
  ) {}

  @Post('boards/:boardId/export-jobs')
  @HttpCode(202)
  @ApiBearerToken()
  @ApiOperation({
    summary: 'Start or replay an OWNER-only asynchronous Board export',
  })
  @ApiCommonErrors([400, 401, 403, 404, 409, 410, 429, 500, 503])
  startJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: BoardExportQueryDto,
  ) {
    return this.jobs.start(user, boardId, key, body.format);
  }

  @Get('boards/:boardId/export-jobs/:id')
  @ApiBearerToken()
  @ApiOperation({
    summary: 'Read current export progress without private bytes',
  })
  jobStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.jobs.status(user, boardId, id);
  }

  @Post('boards/:boardId/export-jobs/:id/retry')
  @HttpCode(202)
  @ApiBearerToken()
  @ApiOperation({
    summary: 'Explicitly retry a failed export using the same job identity',
  })
  retryJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.jobs.retry(user, boardId, id);
  }

  @Get('boards/:boardId/export-jobs/:id/download')
  @ApiBearerToken()
  @ApiOperation({
    summary: 'Download a completed export after fresh OWNER/session checks',
  })
  async downloadJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.jobs.download(user, boardId, id);
    this.send(response, result.body, `kanvexa-board-${boardId}`, result.format);
  }
  @Get('boards/:boardId/export')
  @ApiBearerToken()
  @ApiOperation({
    summary: 'Download an OWNER-only Board snapshot, including archives',
    description:
      'JSON schemaVersion 1 or flat CSV. Maximum 10,000 Cards and 20 MiB; never truncated. See P5-01 backend task record for the versioned schema.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Binary attachment; private, no-store. Filename kanvexa-board-<UUID>-<UTC date>.<format>.',
    content: {
      'application/json': { schema: { type: 'string', format: 'binary' } },
      'text/csv': { schema: { type: 'string', format: 'binary' } },
    },
    headers: {
      'Content-Disposition': { schema: { type: 'string' } },
      'Cache-Control': {
        schema: { type: 'string', example: 'private, no-store' },
      },
      Pragma: { schema: { type: 'string', example: 'no-cache' } },
      'X-Content-Type-Options': {
        schema: { type: 'string', example: 'nosniff' },
      },
    },
  })
  @ApiCommonErrors([400, 401, 403, 404, 413, 429, 500, 503])
  async board(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Query() query: BoardExportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const body = await this.boards.create(user.userId, boardId, query.format);
    await this.snapshots.read(async (manager) => {
      await snapshotAuthorization(manager).requireOwner(user.userId, boardId);
      await this.snapshots.requireSession(user, manager);
    });
    this.send(response, body, `kanvexa-board-${boardId}`, query.format);
  }
  @Get('users/me/export')
  @ApiBearerToken()
  @ApiOperation({
    summary: 'Download the authenticated verified account metadata',
    description:
      'Current user only; JSON schemaVersion 1, maximum 20 MiB. Board content and private file bytes require separate authorized export/download.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Binary JSON attachment; private, no-store. Filename kanvexa-account-<UTC date>.json.',
    content: {
      'application/json': { schema: { type: 'string', format: 'binary' } },
    },
    headers: {
      'Content-Disposition': { schema: { type: 'string' } },
      'Cache-Control': {
        schema: { type: 'string', example: 'private, no-store' },
      },
      Pragma: { schema: { type: 'string', example: 'no-cache' } },
      'X-Content-Type-Options': {
        schema: { type: 'string', example: 'nosniff' },
      },
    },
  })
  @ApiCommonErrors([400, 401, 403, 413, 429, 500, 503])
  async account(
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: AccountExportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.accounts.create(user.userId);
    await this.snapshots.read(async (manager) => {
      await this.accounts.recheck(user.userId, result, manager);
      await this.snapshots.requireSession(user, manager);
    });
    this.send(response, result.body, 'kanvexa-account', 'json');
  }
  private send(
    response: Response,
    body: Buffer,
    prefix: string,
    format: 'json' | 'csv',
  ): void {
    response.setHeader(
      'Content-Type',
      format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/json; charset=utf-8',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${prefix}-${new Date().toISOString().slice(0, 10)}.${format}"`,
    );
    response.status(200).send(body);
  }
}
