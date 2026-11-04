import type { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../../src/config/environment';
import { TaskNotificationWorker } from '../../src/api/notifications/task-notification-worker.service';
import type { DueReminderScanner } from '../../src/api/notifications/due-reminder-scanner.service';
import type { TaskEmailDispatcher } from '../../src/api/notifications/task-email-dispatcher.service';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

describe('task notification lifecycle', () => {
  it.each([
    [false, false, 0, 0],
    [true, false, 1, 0],
    [true, true, 1, 1],
    [false, true, 0, 0],
  ])(
    'jobs=%s email=%s bounds the initial poll',
    async (jobs, email, scans, sends) => {
      const values: Record<string, boolean | number> = {
        TASK_NOTIFICATION_JOBS_ENABLED: jobs,
        TASK_NOTIFICATION_EMAIL_ENABLED: email,
        TASK_NOTIFICATION_POLL_SECONDS: 60,
        TASK_NOTIFICATION_BATCH_SIZE: 50,
      };
      const scanner = { scan: jest.fn().mockResolvedValue(undefined) };
      const dispatcher = {
        drain: jest.fn().mockResolvedValue(undefined),
        releaseOwned: jest.fn().mockResolvedValue(undefined),
      };
      const worker = new TaskNotificationWorker(
        { get: (key: string) => values[key] } as unknown as ConfigService<
          EnvironmentConfig,
          true
        >,
        scanner as unknown as DueReminderScanner,
        dispatcher as unknown as TaskEmailDispatcher,
      );
      worker.onApplicationBootstrap();
      await worker.onModuleDestroy();
      expect(scanner.scan).toHaveBeenCalledTimes(scans);
      expect(dispatcher.drain).toHaveBeenCalledTimes(sends);
      expect(dispatcher.releaseOwned).toHaveBeenCalledTimes(scans);
    },
  );
});
