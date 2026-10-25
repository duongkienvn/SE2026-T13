import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserPreferencesResponseDto } from './dto/user-preferences-response.dto';
import { UserPreferencesService } from './user-preferences.service';

@ApiTags('users')
@Controller('users/me/preferences')
@UseGuards(JwtAuthGuard)
export class UserPreferencesController {
  constructor(private readonly preferences: UserPreferencesService) {}

  @Get()
  @SerializeResponse(UserPreferencesResponseDto)
  @ApiBearerToken()
  @ApiSuccess({
    type: UserPreferencesResponseDto,
    summary: 'Read account preferences; defaults do not create a row',
  })
  @ApiCommonErrors([401, 404, 429, 500])
  get(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserPreferencesResponseDto> {
    return this.preferences.get(user.userId);
  }
}
