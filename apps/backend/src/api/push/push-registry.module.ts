import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PushController } from './push.controller';
import { PushRegistryService } from './push-registry.service';
import { PushRequestGuard } from './push-request.guard';
@Module({
  imports: [AuthModule],
  controllers: [PushController],
  providers: [PushRegistryService, PushRequestGuard],
})
export class PushRegistryModule {}
