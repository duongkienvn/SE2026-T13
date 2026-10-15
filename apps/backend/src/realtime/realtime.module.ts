import { Module } from '@nestjs/common';
import { AuthModule } from '../api/auth/auth.module';
import { RealtimeAccessModule } from './realtime-access.module';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, RealtimeAccessModule],
  providers: [RealtimeAuthService, RealtimeGateway],
})
export class RealtimeModule {}
