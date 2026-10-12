import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApplicationException } from '../../exceptions/application.exception';

@Injectable()
export class ReadinessService {
  constructor(private readonly dataSource: DataSource) {}

  async check(): Promise<{ status: 'ok'; database: 'ok' }> {
    if (!this.dataSource.isInitialized) {
      throw new ApplicationException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'Database unavailable',
      );
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.dataSource.query('SELECT 1'),
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
