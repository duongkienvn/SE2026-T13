import { Module } from '@nestjs/common';
import { BoardRoomCoordinator } from './board-room-coordinator.service';
import { BoardPresenceService } from './board-presence.service';

// No business imports: BoardMembersModule can use this without a cycle.
@Module({
  providers: [BoardRoomCoordinator, BoardPresenceService],
  exports: [BoardRoomCoordinator, BoardPresenceService],
})
export class RealtimeAccessModule {}
