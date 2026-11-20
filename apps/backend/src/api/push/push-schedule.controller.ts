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
import { PushRequestGuard } from './push-request.guard';
import { PushScheduleDto, UpdatePushScheduleDto } from './push-schedule.dto';
import { PushScheduleService } from './push-schedule.service';

@ApiTags('push')
@Controller('users/me/push-schedule')
@UseGuards(JwtAuthGuard, PushRequestGuard)
export class PushScheduleController {
  constructor(private readonly schedules: PushScheduleService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(PushScheduleDto)
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.schedules.get(user.userId);
  }
  @Patch()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(PushScheduleDto)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: UpdatePushScheduleDto,
  ) {
    return this.schedules.update(user, input);
  }
}
