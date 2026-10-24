import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { LoginRequestDto } from './dto/login-request.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { EmailVerificationService } from './email-verification.service';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { setTimeout as delay } from 'node:timers/promises';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly verification: EmailVerificationService,
  ) {}

  @Post('verify-email')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContent({ summary: 'Verify an email address without logging in' })
  @ApiCommonErrors([400, 429, 500])
  async verify(@Body() input: VerifyEmailDto): Promise<void> {
    await this.verification.verify(input.token);
  }

  @Post('resend-verification')
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseMessage(
    'If verification is needed, an email may arrive. Delivery may be delayed or unavailable; try again after 60 seconds.',
  )
  @ApiOperation({
    summary: 'Request verification email with a generic response',
  })
  @ApiResponse({
    status: 202,
    description:
      'Conditional acknowledgement; does not confirm account existence or delivery.',
  })
  @ApiCommonErrors([400, 429, 500])
  async resend(@Body() input: ResendVerificationDto): Promise<null> {
    // Match the provider timeout for every account state to reduce enumeration
    // through obvious network-vs-no-network response timing. No DB lock is held.
    await Promise.all([this.verification.send(input.email), delay(10_500)]);
    return null;
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @HttpCode(HttpStatus.CREATED)
  @SerializeResponse(UserResponseDto)
  @ResponseMessage('Registered')
  @ApiSuccess({
    type: UserResponseDto,
    status: HttpStatus.CREATED,
    summary: 'Register a user',
  })
  @ApiCommonErrors([400, 409, 429, 500, 503])
  register(@Body() input: RegisterRequestDto): Promise<UserResponseDto> {
    return this.authService.register(input);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @SerializeResponse(LoginResponseDto)
  @ResponseMessage('Logged in')
  @ApiSuccess({ type: LoginResponseDto, summary: 'Log in a user' })
  @ApiCommonErrors([400, 401, 403, 429, 500])
  login(@Body() input: LoginRequestDto): Promise<LoginResponseDto> {
    return this.authService.login(input);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerToken()
  @ApiNoContent({ summary: 'Accept a stateless logout request' })
  @ApiCommonErrors([401, 429, 500])
  logout(): undefined {
    return undefined;
  }
}
