import { Module } from '@nestjs/common';
import { ActivityWriterService } from './activity-writer.service';

@Module({
  providers: [ActivityWriterService],
  exports: [ActivityWriterService],
})
export class ActivityWriterModule {}
