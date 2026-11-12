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
      Array.from({ length: 4 }, () => this.jobs.processNext()),
    );
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('Export worker batch incomplete');
  }
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.current;
  }
}
