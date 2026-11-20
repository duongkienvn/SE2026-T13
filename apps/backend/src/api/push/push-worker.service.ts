import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../../config/environment';
import { PushDispatcher } from './push-dispatcher.service';
@Injectable()
export class PushWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushWorker.name);
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = false;
  constructor(
    private readonly config: ConfigService<EnvironmentConfig, true>,
    private readonly dispatcher: PushDispatcher,
  ) {}
  onModuleInit() {
    if (this.config.get('PUSH_NOTIFICATIONS_ENABLED', { infer: true }))
      this.tick();
  }
  private tick() {
    if (this.stopped) return;
    this.running = this.dispatcher
      .drain()
      .catch(() => {
        this.logger.warn(
          'Push worker cycle failed; leases will recover safely',
        );
      })
      .finally(() => {
        this.running = undefined;
        if (!this.stopped) {
          this.timer = setTimeout(() => this.tick(), 15_000);
          this.timer.unref();
        }
      });
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
    await this.dispatcher.releaseOwned();
  }
}
