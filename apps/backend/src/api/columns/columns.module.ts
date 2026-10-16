import { Module } from '@nestjs/common';
import { RealtimeDeliveryModule } from '../../realtime/realtime-delivery.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BoardMembersModule } from '../board-members/board-members.module';
import { Board } from '../boards/entities/board.entity';
import { Card } from '../cards/entities/card.entity';
import { ColumnsController } from './columns.controller';
import { ColumnsService } from './columns.service';
import { BoardColumn } from './entities/board-column.entity';

@Module({
  imports: [
    RealtimeDeliveryModule,
    AuthModule,
    BoardMembersModule,
    TypeOrmModule.forFeature([Board, BoardColumn, Card]),
  ],
  controllers: [ColumnsController],
  providers: [ColumnsService],
})
export class ColumnsModule {}
