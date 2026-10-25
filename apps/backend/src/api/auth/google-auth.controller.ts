import {
  Body,
  Controller,
  Get,
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
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './constants/auth.constants';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleAuthService } from './google-auth.service';
import { GoogleAuthDto, GoogleLinkDto } from './dto/google-auth.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { LinkedProvidersDto } from './dto/linked-providers.dto';

@Controller('auth')
export class GoogleAuthController {
  constructor(private readonly google: GoogleAuthService) {}

  @Post('google')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @SerializeResponse(LoginResponseDto)
  @ResponseMessage('Logged in')
  @ApiSuccess({
    type: LoginResponseDto,
    summary: 'Exchange a verified Google ID token for a Kanvexa session',
  })
  @ApiCommonErrors([400, 401, 403, 409, 429, 500, 503])
  signIn(@Body() input: GoogleAuthDto): Promise<LoginResponseDto> {
    return this.google.signIn(input.credential);
  }

  @Post('google/link')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerToken()
  @ApiNoContent({
    summary: 'Connect Google after current-password reauthentication',
  })
  @ApiCommonErrors([400, 401, 403, 409, 429, 500, 503])
  link(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: GoogleLinkDto,
  ): Promise<void> {
    return this.google.link(user.userId, input.credential, input.password);
  }

  @Get('linked-providers')
  @UseGuards(JwtAuthGuard)
  @ApiBearerToken()
  @SerializeResponse(LinkedProvidersDto)
  @ApiSuccess({
    type: LinkedProvidersDto,
    summary: 'Get connected account status without provider identifiers',
  })
  @ApiCommonErrors([401, 429, 500])
  linkedProviders(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LinkedProvidersDto> {
    return this.google.linkedProviders(user.userId);
  }
}
