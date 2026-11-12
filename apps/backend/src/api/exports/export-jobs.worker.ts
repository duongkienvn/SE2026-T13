import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ExportJobsService } from './export-jobs.service';

@Injectable()
export class ExportJobsWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private current: Promise<void> | null = null;
  private stopping = false;
  private readonly logger = new Logger(ExportJobsWorker.name);
  constructor(private readonly jobs: ExportJobsService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (this.current) return;
      this.current = this.tick()
        .catch(() => {
          this.logger.warn('Export worker temporarily unavailable');
        })
        .finally(() => {
          this.current = null;
        });
    }, 250);
    this.timer.unref();
  }
  private async tick(): Promise<void> {
    await this.jobs.sweep();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => this.drainLane()),
    );
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('Export worker batch incomplete');
  }
  private async drainLane(): Promise<void> {
    // Return to the scheduler periodically so expiry cleanup still runs under load.
    for (let processed = 0; processed < 32 && !this.stopping; processed++) {
      if (!(await this.jobs.processNext())) break;
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.current;
  }
}
