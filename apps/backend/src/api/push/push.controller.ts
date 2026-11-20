import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { SerializeResponse } from '../../decorators/response.decorators';
import { PushRegistryService } from './push-registry.service';
import {
  CurrentPushDeviceDto,
  CurrentPushQueryDto,
  PushPreferencesDto,
  RegisteredPushDeviceDto,
  RegisterPushDeviceDto,
  UpdatePushPreferencesDto,
} from './push.dto';
import { PushRequestGuard } from './push-request.guard';

@ApiTags('push')
@Controller('users/me')
@UseGuards(JwtAuthGuard, PushRequestGuard)
export class PushController {
  constructor(private readonly registry: PushRegistryService) {}
  @Get('push-preferences')
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(PushPreferencesDto)
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.registry.get(user.userId);
  }
  @Patch('push-preferences')
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(PushPreferencesDto)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: UpdatePushPreferencesDto,
  ) {
    return this.registry.update(user, input.enabled);
  }
  @Post('push-devices')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(RegisteredPushDeviceDto)
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: RegisterPushDeviceDto,
  ) {
    return this.registry.register(user, input);
  }
  @Get('push-devices/current')
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(CurrentPushDeviceDto)
  current(
    @CurrentUser() user: AuthenticatedUser,
    @Query() input: CurrentPushQueryDto,
  ) {
    return this.registry.current(user, input.installationId);
  }
  @Delete('push-devices/:installationId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('installationId', new ParseUUIDPipe({ version: '4' }))
    installationId: string,
  ) {
    return this.registry.remove(user, installationId);
  }
}
