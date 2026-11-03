import {
  Controller,
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
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { SerializeResponse } from '../../decorators/response.decorators';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiPaginated,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import {
  NotificationReadAllResultDto,
  NotificationResponseDto,
  NotificationUnreadCountDto,
} from './dto/notification-response.dto';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationReadBodyGuard } from './notification-read-body.guard';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly inbox: NotificationInboxService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(NotificationResponseDto)
  @ApiBearerToken()
  @ApiPaginated(NotificationResponseDto, {
    summary:
      'List recipient-owned notification history, newest first, resolving only currently authorized details',
  })
  @ApiCommonErrors([400, 401, 429, 500])
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsDto,
  ) {
    return this.inbox.list(user.userId, query);
  }
  @Get('unread-count')
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(NotificationUnreadCountDto)
  @ApiBearerToken()
  @ApiSuccess({
    type: NotificationUnreadCountDto,
    summary: 'Count all persisted unread rows, including unavailable history',
  })
  @ApiCommonErrors([401, 429, 500])
  count(@CurrentUser() user: AuthenticatedUser) {
    return this.inbox.unreadCount(user.userId);
  }
  @Patch(':notificationId/read')
  @UseGuards(NotificationReadBodyGuard)
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(NotificationResponseDto)
  @ApiBearerToken()
  @ApiParam({ name: 'notificationId', format: 'uuid' })
  @ApiSuccess({
    type: NotificationResponseDto,
    summary:
      'Idempotently mark own notification as read; preserve the first readAt',
  })
  @ApiCommonErrors([400, 401, 404, 429, 500])
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId', ParseUUIDPipe) id: string,
  ) {
    return this.inbox.read(user.userId, id);
  }
  @Post('read-all')
  @UseGuards(NotificationReadBodyGuard)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(NotificationReadAllResultDto)
  @ApiBearerToken()
  @ApiSuccess({
    type: NotificationReadAllResultDto,
    summary:
      'Atomically mark current own unread history as read, returning the updated row count',
  })
  @ApiCommonErrors([400, 401, 404, 429, 500])
  all(@CurrentUser() user: AuthenticatedUser) {
    return this.inbox.readAll(user.userId);
  }
}
