import { Module } from '@nestjs/common';
import { AuthModule } from '../api/auth/auth.module';
import { BoardMembersModule } from '../api/board-members/board-members.module';
import { BoardRoomService } from './board-room.service';
import { RealtimeAccessModule } from './realtime-access.module';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeBroadcastService } from './realtime-broadcast.service';

@Module({
  imports: [AuthModule, BoardMembersModule, RealtimeAccessModule],
  providers: [
    RealtimeAuthService,
    RealtimeGateway,
    BoardRoomService,
    RealtimeBroadcastService,
  ],
  exports: [RealtimeBroadcastService],
})
export class RealtimeModule {}
