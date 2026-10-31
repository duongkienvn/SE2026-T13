import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BoardMembersModule } from '../board-members/board-members.module';
import { Board } from '../boards/entities/board.entity';
import { Card } from '../cards/entities/card.entity';
import { CardLabel } from '../cards/entities/card-label.entity';
import { BoardLabel } from './entities/board-label.entity';
import {
  BoardLabelsController,
  CardLabelsController,
} from './labels.controller';
import { LabelsService } from './labels.service';
import { RealtimeDeliveryModule } from '../../realtime/realtime-delivery.module';

@Module({
  imports: [
    AuthModule,
    BoardMembersModule,
    RealtimeDeliveryModule,
    TypeOrmModule.forFeature([Board, Card, BoardLabel, CardLabel]),
  ],
  controllers: [BoardLabelsController, CardLabelsController],
  providers: [LabelsService],
  exports: [LabelsService],
})
export class LabelsModule {}
