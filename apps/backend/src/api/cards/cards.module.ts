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

@Module({
  imports: [
    RealtimeDeliveryModule,
    AuthModule,
    BoardMembersModule,
    TypeOrmModule.forFeature([
      Card,
      CardAssignee,
      Board,
      BoardColumn,
      BoardMember,
    ]),
  ],
  controllers: [CardsController],
  providers: [CardsService],
})
export class CardsModule {}
