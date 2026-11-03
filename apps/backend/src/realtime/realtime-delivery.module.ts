import { Module } from '@nestjs/common';
import { AuthModule } from '../api/auth/auth.module';
import { RealtimeAccessModule } from './realtime-access.module';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeBroadcastService } from './realtime-broadcast.service';
import { BoardEventPublisher } from './board-event-publisher.service';
import { NotificationEventPublisher } from './notification-event-publisher.service';

/** Transport delivery has no dependency on board business modules. */
@Module({
  imports: [AuthModule, RealtimeAccessModule],
  providers: [
    RealtimeAuthService,
    RealtimeBroadcastService,
    BoardEventPublisher,
    NotificationEventPublisher,
  ],
  exports: [
    RealtimeAuthService,
    RealtimeBroadcastService,
    BoardEventPublisher,
    NotificationEventPublisher,
    RealtimeAccessModule,
  ],
})
export class RealtimeDeliveryModule {}
