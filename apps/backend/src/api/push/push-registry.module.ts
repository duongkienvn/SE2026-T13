import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PushController } from './push.controller';
import { PushRegistryService } from './push-registry.service';
import { PushRequestGuard } from './push-request.guard';
import { PushScheduleController } from './push-schedule.controller';
import { PushScheduleService } from './push-schedule.service';
@Module({
  imports: [AuthModule],
  controllers: [PushController, PushScheduleController],
  providers: [PushRegistryService, PushScheduleService, PushRequestGuard],
})
export class PushRegistryModule {}
