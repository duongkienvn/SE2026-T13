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

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
  @ApiCommonErrors([400, 409, 429, 500])
  register(@Body() input: RegisterRequestDto): Promise<UserResponseDto> {
    return this.authService.register(input);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @SerializeResponse(LoginResponseDto)
  @ResponseMessage('Logged in')
  @ApiSuccess({ type: LoginResponseDto, summary: 'Log in a user' })
  @ApiCommonErrors([400, 401, 429, 500])
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
