import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiNoContent,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import {
  ResponseMessage,
  SerializeResponse,
} from '../../decorators/response.decorators';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './constants/auth.constants';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { EmailChangeService } from './email-change.service';
import { EmailChangeReauthenticationService } from './email-change-reauthentication.service';
import {
  ConfirmEmailChangeDto,
  PendingEmailChangeDto,
  RequestEmailChangeDto,
} from './dto/email-change.dto';

export const EMAIL_CHANGE_ACKNOWLEDGEMENT =
  'If this email change is eligible, a confirmation link may arrive. Delivery may be delayed or unavailable; try again after 60 seconds.';
@Controller('auth/email-change')
@UseGuards(JwtAuthGuard)
export class EmailChangeController {
  private readonly logger = new Logger(EmailChangeController.name);
  constructor(
    private readonly changes: EmailChangeService,
    private readonly reauthentication: EmailChangeReauthenticationService,
  ) {}
  @Post('request')
  @HttpCode(202)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @ApiBearerToken()
  @ResponseMessage(EMAIL_CHANGE_ACKNOWLEDGEMENT)
  @ApiOperation({
    summary:
      'Request a verified email change using exactly one fresh password or linked Google proof',
  })
  @ApiResponse({
    status: 202,
    description: EMAIL_CHANGE_ACKNOWLEDGEMENT,
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        statusCode: { type: 'integer', example: 202 },
        message: { type: 'string', example: EMAIL_CHANGE_ACKNOWLEDGEMENT },
        data: { nullable: true, example: null },
      },
    },
  })
  @ApiCommonErrors([400, 401, 403, 429, 503])
  async request(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: RequestEmailChangeDto,
  ): Promise<null> {
    const proof = await this.reauthentication.verify(user, input);
    // Credential validation gates acceptance. Only this independent timer gates
    // the subsequent generic response, never target eligibility or delivery.
    void Promise.resolve()
      .then(() => this.changes.request(proof, input.newEmail))
      .catch(() =>
        this.logger.warn('Email change request processing unavailable'),
      );
    await delay(10_500);
    return null;
  }
  @Get('pending')
  @Header('Cache-Control', 'private, no-store')
  @ApiBearerToken()
  @SerializeResponse(PendingEmailChangeDto)
  @ApiSuccess({
    type: PendingEmailChangeDto,
    summary: 'Get own masked pending email change or null',
    description:
      'data is null when no current unexpired/unconsumed intent exists. No token, hash, cleartext destination or delivery status is returned.',
  })
  @ApiCommonErrors([401, 429, 500])
  pending(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PendingEmailChangeDto | null> {
    return this.changes.pending(user);
  }
  @Post('confirm')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerToken()
  @ApiNoContent({
    summary:
      'Confirm own new mailbox, revoke existing sessions and sign in again',
  })
  @ApiCommonErrors([400, 401, 409, 429, 500])
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: ConfirmEmailChangeDto,
  ): Promise<void> {
    return this.changes.confirm(user, input.token);
  }
}
