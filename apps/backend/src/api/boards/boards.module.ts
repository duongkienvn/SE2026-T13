import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BoardMembersModule } from '../board-members/board-members.module';
import { BoardMember } from '../board-members/entities/board-member.entity';
import { Board } from './entities/board.entity';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { ActivityWriterModule } from '../activities/activity-writer.module';
import { RealtimeDeliveryModule } from '../../realtime/realtime-delivery.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { BoardVisibilityService } from './board-visibility.service';
import { BoardVisibilityController } from './board-visibility.controller';

@Module({
  imports: [
    WorkspacesModule,
    AuthModule,
    BoardMembersModule,
    ActivityWriterModule,
    RealtimeDeliveryModule,
    TypeOrmModule.forFeature([Board, BoardMember]),
  ],
  controllers: [BoardsController, BoardVisibilityController],
  providers: [BoardsService, BoardVisibilityService],
})
export class BoardsModule {}
