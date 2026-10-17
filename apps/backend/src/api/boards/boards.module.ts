import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BoardMembersModule } from '../board-members/board-members.module';
import { BoardMember } from '../board-members/entities/board-member.entity';
import { Board } from './entities/board.entity';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { ActivityWriterModule } from '../activities/activity-writer.module';

@Module({
  imports: [
    AuthModule,
    BoardMembersModule,
    ActivityWriterModule,
    TypeOrmModule.forFeature([Board, BoardMember]),
  ],
  controllers: [BoardsController],
  providers: [BoardsService],
})
export class BoardsModule {}
