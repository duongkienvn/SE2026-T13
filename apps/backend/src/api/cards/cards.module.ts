import { Module } from '@nestjs/common';
import { RealtimeDeliveryModule } from '../../realtime/realtime-delivery.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BoardMembersModule } from '../board-members/board-members.module';
import { BoardMember } from '../board-members/entities/board-member.entity';
import { Board } from '../boards/entities/board.entity';
import { BoardColumn } from '../columns/entities/board-column.entity';
import { Card } from './entities/card.entity';
import { CardAssignee } from './entities/card-assignee.entity';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';
import { ActivityWriterModule } from '../activities/activity-writer.module';

import { CardChecklistsController } from './card-checklists.controller';
import { CardChecklistsService } from './card-checklists.service';
import { CardChecklist } from './entities/card-checklist.entity';
import { CardChecklistItem } from './entities/card-checklist-item.entity';

@Module({
  imports: [
    RealtimeDeliveryModule,
    AuthModule,
    BoardMembersModule,
    ActivityWriterModule,
    TypeOrmModule.forFeature([
      Card,
      CardAssignee,
      CardChecklist,
      CardChecklistItem,
      Board,
      BoardColumn,
      BoardMember,
    ]),
  ],
  controllers: [CardsController, CardChecklistsController],
  providers: [CardsService, CardChecklistsService],
  exports: [CardChecklistsService],
})
export class CardsModule {}
