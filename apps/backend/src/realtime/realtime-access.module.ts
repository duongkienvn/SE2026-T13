import { Module } from '@nestjs/common';
import { BoardRoomCoordinator } from './board-room-coordinator.service';

// No business imports: BoardMembersModule can use this without a cycle.
@Module({
  providers: [BoardRoomCoordinator],
  exports: [BoardRoomCoordinator],
})
export class RealtimeAccessModule {}
