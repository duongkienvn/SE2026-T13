import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AttachmentCleanupService } from '../../src/api/cards/attachments/attachment-cleanup.service';
import { DisabledAttachmentStorage } from '../../src/api/cards/attachments/attachment-storage';
import { MemoryAttachmentStorage } from '../../src/api/cards/attachments/attachment-storage-drivers';
import { Board } from '../../src/api/boards/entities/board.entity';
import type { EnvironmentConfig } from '../../src/config/environment';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
const config = (NODE_ENV: 'test' | 'development') =>
  new ConfigService({ NODE_ENV }) as ConfigService<EnvironmentConfig, true>;
describe('private attachment worker lifecycle', () => {
  it('does not access SQL/storage while disabled and never schedules test background work', async () => {
    const repository = {} as Repository<Board>;
    const disabled = new AttachmentCleanupService(
      repository,
      new DisabledAttachmentStorage(),
      config('development'),
    );
    disabled.onModuleInit();
    await expect(disabled.sweep()).resolves.toBeUndefined();
    await disabled.onModuleDestroy();
    const testWorker = new AttachmentCleanupService(
      repository,
      new MemoryAttachmentStorage(),
      config('test'),
    );
    const sweep = jest.spyOn(testWorker, 'sweep').mockResolvedValue();
    testWorker.onModuleInit();
    expect(sweep).not.toHaveBeenCalled();
    await testWorker.onModuleDestroy();
  });
  it('resumes on startup, schedules bounded sweeps and stops its timer on shutdown', async () => {
    jest.useFakeTimers();
    try {
      const worker = new AttachmentCleanupService(
        {} as Repository<Board>,
        new MemoryAttachmentStorage(),
        config('development'),
      );
      const sweep = jest.spyOn(worker, 'sweep').mockResolvedValue();
      worker.onModuleInit();
      expect(sweep).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(5 * 60_000);
      expect(sweep).toHaveBeenCalledTimes(2);
      await worker.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(5 * 60_000);
      expect(sweep).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
