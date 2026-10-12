import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApplicationException } from '../../exceptions/application.exception';

@Injectable()
export class ReadinessService {
  private activeProbe?: Promise<void>;

  constructor(private readonly dataSource: DataSource) {}

  private async probeDatabase(): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    try {
      await runner.connect();
      await runner.startTransaction();
      await runner.query('SET LOCAL statement_timeout = 1000');
      await runner.query('SELECT 1');
    } finally {
      try {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
      } finally {
        await runner.release();
      }
    }
  }

  async check(): Promise<{ status: 'ok'; database: 'ok' }> {
    if (!this.dataSource.isInitialized) {
      throw new ApplicationException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'Database unavailable',
      );
    }
    if (!this.activeProbe) {
      this.activeProbe = this.probeDatabase().finally(() => {
        this.activeProbe = undefined;
      });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.activeProbe,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Readiness timeout')),
            1000,
          );
        }),
      ]);
      return { status: 'ok', database: 'ok' };
    } catch {
      throw new ApplicationException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'Database unavailable',
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
