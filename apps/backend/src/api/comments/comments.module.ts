import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BoardMembersModule } from '../board-members/board-members.module';
import { Board } from '../boards/entities/board.entity';
import { Card } from '../cards/entities/card.entity';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { Comment } from './entities/comment.entity';
import { ActivityWriterModule } from '../activities/activity-writer.module';
import { RealtimeDeliveryModule } from '../../realtime/realtime-delivery.module';

@Module({
  imports: [
    AuthModule,
    BoardMembersModule,
    ActivityWriterModule,
    RealtimeDeliveryModule,
    TypeOrmModule.forFeature([Comment, Card, Board]),
  ],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
