import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Board } from '../boards/entities/board.entity';
import { BoardMembersController } from './board-members.controller';
import { BoardMembersService } from './board-members.service';
import { BoardAuthorizationService } from './board-authorization.service';
import { BoardMember } from './entities/board-member.entity';
import { RealtimeAccessModule } from '../../realtime/realtime-access.module';
import { RealtimeDeliveryModule } from '../../realtime/realtime-delivery.module';
import { ActivityWriterModule } from '../activities/activity-writer.module';

@Module({
  imports: [
    AuthModule,
    RealtimeAccessModule,
    RealtimeDeliveryModule,
    ActivityWriterModule,
    TypeOrmModule.forFeature([Board, BoardMember]),
  ],
  controllers: [BoardMembersController],
  providers: [BoardAuthorizationService, BoardMembersService],
  exports: [BoardAuthorizationService, BoardMembersService],
})
export class BoardMembersModule {}
