import {
  Body,
  Controller,
  Get,
  Header,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { SerializeResponse } from '../../decorators/response.decorators';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import {
  NotificationPreferencesDto,
  UpdateNotificationPreferencesDto,
} from './dto/notification-preferences.dto';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationPreferencesBodyGuard } from './notification-preferences-body.guard';

@ApiTags('notification-preferences')
@Controller('users/me/notification-preferences')
@UseGuards(JwtAuthGuard)
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(NotificationPreferencesDto)
  @ApiBearerToken()
  @ApiSuccess({
    type: NotificationPreferencesDto,
    summary:
      'Read notification preferences; absent row returns defaults without writes',
  })
  @ApiCommonErrors([401, 429, 500])
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.preferences.get(user.userId);
  }

  @Patch()
  @UseGuards(NotificationPreferencesBodyGuard)
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(NotificationPreferencesDto)
  @ApiBearerToken()
  @ApiSuccess({
    type: NotificationPreferencesDto,
    summary:
      'Partially update recognized boolean leaves; in-app and optional task email are independent',
  })
  @ApiCommonErrors([400, 401, 404, 429, 500])
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: UpdateNotificationPreferencesDto,
  ) {
    return this.preferences.update(user.userId, input);
  }
}
