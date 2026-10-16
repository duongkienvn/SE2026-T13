import { Module } from '@nestjs/common';
import { AuthModule } from '../api/auth/auth.module';
import { BoardMembersModule } from '../api/board-members/board-members.module';
import { BoardRoomService } from './board-room.service';
import { RealtimeAccessModule } from './realtime-access.module';
import { RealtimeDeliveryModule } from './realtime-delivery.module';
import { RealtimeGateway } from './realtime.gateway';
import { BoardRoomRateLimiter } from './board-room-rate-limiter.service';

@Module({
  imports: [
    AuthModule,
    BoardMembersModule,
    RealtimeAccessModule,
    RealtimeDeliveryModule,
  ],
  providers: [RealtimeGateway, BoardRoomService, BoardRoomRateLimiter],
  exports: [RealtimeDeliveryModule],
})
export class RealtimeModule {}
