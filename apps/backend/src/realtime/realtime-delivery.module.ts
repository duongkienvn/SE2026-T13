import { Module } from '@nestjs/common';
import { AuthModule } from '../api/auth/auth.module';
import { RealtimeAccessModule } from './realtime-access.module';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeBroadcastService } from './realtime-broadcast.service';

/** Transport delivery has no dependency on board business modules. */
@Module({
  imports: [AuthModule, RealtimeAccessModule],
  providers: [RealtimeAuthService, RealtimeBroadcastService],
  exports: [
    RealtimeAuthService,
    RealtimeBroadcastService,
    RealtimeAccessModule,
  ],
})
export class RealtimeDeliveryModule {}
