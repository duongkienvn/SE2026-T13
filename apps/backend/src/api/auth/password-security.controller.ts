import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { setTimeout as delay } from 'node:timers/promises';
import { ResponseMessage } from '../../decorators/response.decorators';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiNoContent,
} from '../../decorators/swagger-response.decorators';
import { PasswordSecurityService } from './password-security.service';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
} from './dto/password-security.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './constants/auth.constants';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PasswordChangeThrottlerGuard } from './guards/password-change-throttler.guard';

export const RECOVERY_ACKNOWLEDGEMENT =
  'If this email is eligible, a recovery link may arrive. Delivery may be delayed or unavailable; try again after 60 seconds.';

@Controller('auth')
export class PasswordSecurityController {
  constructor(private readonly security: PasswordSecurityService) {}

  @Post('forgot-password')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @ResponseMessage(RECOVERY_ACKNOWLEDGEMENT)
  @ApiOperation({
    summary: 'Request password recovery without disclosing account state',
  })
  @ApiResponse({
    status: 202,
    description: RECOVERY_ACKNOWLEDGEMENT,
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        statusCode: { type: 'integer', example: 202 },
        message: { type: 'string' },
        data: { nullable: true, example: null },
      },
    },
  })
  @ApiCommonErrors([400, 429])
  async forgot(@Body() input: ForgotPasswordDto): Promise<null> {
    // Only the timer gates HTTP completion; DB/delivery latency must not reveal
    // eligibility. Handle the entire background job, including synchronous throws
    // and transaction/final-update rejections, without logging sensitive data.
    void Promise.resolve()
      .then(() => this.security.send(input.email))
      .catch(() => undefined);
    await delay(10_500);
    return null;
  }

  @Post('reset-password')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiNoContent({
    summary:
      'Reset or set a password using a verified email recovery proof; log in again',
  })
  @ApiCommonErrors([400, 429, 500])
  reset(@Body() input: ResetPasswordDto): Promise<void> {
    return this.security.reset(input.token, input.newPassword);
  }

  @Post('change-password')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, PasswordChangeThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @ApiBearerToken()
  @ApiNoContent({
    summary: 'Change a local password after reauthentication; log in again',
  })
  @ApiCommonErrors([400, 401, 403, 429, 500])
  change(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: ChangePasswordDto,
  ): Promise<void> {
    return this.security.change(
      user.userId,
      user.authVersion,
      input.currentPassword,
      input.newPassword,
    );
  }
}
