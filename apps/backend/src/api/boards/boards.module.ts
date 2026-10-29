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
import { BoardMoveController } from './board-move.controller';
import { BoardMoveService } from './board-move.service';
import { BoardPolicyController } from './board-policy.controller';
import { BoardPolicyService } from './board-policy.service';
import { Workspace } from '../workspaces/entities/workspace.entity';

@Module({
  imports: [
    WorkspacesModule,
    AuthModule,
    BoardMembersModule,
    ActivityWriterModule,
    RealtimeDeliveryModule,
    TypeOrmModule.forFeature([Board, BoardMember, Workspace]),
  ],
  controllers: [
    BoardsController,
    BoardVisibilityController,
    BoardMoveController,
    BoardPolicyController,
  ],
  providers: [
    BoardsService,
    BoardVisibilityService,
    BoardMoveService,
    BoardPolicyService,
  ],
})
export class BoardsModule {}
