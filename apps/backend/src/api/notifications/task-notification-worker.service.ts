import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentConfig } from '../../config/environment';
import { DueReminderScanner } from './due-reminder-scanner.service';
import { TaskEmailDispatcher } from './task-email-dispatcher.service';

@Injectable()
export class TaskNotificationWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(TaskNotificationWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;
  private started = false;
  constructor(
    private readonly config: ConfigService<EnvironmentConfig, true>,
    private readonly scanner: DueReminderScanner,
    private readonly dispatcher: TaskEmailDispatcher,
  ) {}
  onApplicationBootstrap(): void {
    if (!this.config.get('TASK_NOTIFICATION_JOBS_ENABLED', { infer: true }))
      return;
    this.started = true;
    this.tick();
  }
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
    if (this.started) {
      try {
        await this.dispatcher.releaseOwned();
      } catch {
        this.logger.warn('Task notification lease release failed');
      }
    }
  }
  private tick(): void {
    if (this.stopped) return;
    this.running = this.run()
      .catch(() => this.logger.error('Task notification worker poll failed'))
      .finally(() => {
        if (!this.stopped)
          this.timer = setTimeout(
            () => this.tick(),
            this.config.get('TASK_NOTIFICATION_POLL_SECONDS', { infer: true }) *
              1000,
          );
      });
  }
  private async run(): Promise<void> {
    const limit = this.config.get('TASK_NOTIFICATION_BATCH_SIZE', {
      infer: true,
    });
    await this.scanner.scan(limit);
    if (this.config.get('TASK_NOTIFICATION_EMAIL_ENABLED', { infer: true }))
      await this.dispatcher.drain(limit);
  }
}
