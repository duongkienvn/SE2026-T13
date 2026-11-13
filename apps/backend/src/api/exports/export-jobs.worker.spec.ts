import { ExportJobsWorker } from './export-jobs.worker';
import type { ExportJobsService } from './export-jobs.service';

jest.mock('@nestjs/typeorm', () => ({ InjectRepository: () => () => {} }));

it('drains queued work on the first tick with at most four simultaneous claims', async () => {
  jest.useFakeTimers();
  let remaining = 12;
  let completed = 0;
  let inFlight = 0;
  let peak = 0;
  const jobs = {
    sweep: jest.fn(async () => {}),
    processNext: jest.fn(async () => {
      if (remaining === 0) return false;
      remaining--;
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      completed++;
      return true;
    }),
  };
  const worker = new ExportJobsWorker(jobs as unknown as ExportJobsService);
  try {
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(250);
    expect(completed).toBe(12);
    expect(peak).toBe(4);
    expect(jobs.sweep).toHaveBeenCalledTimes(1);
  } finally {
    await worker.onModuleDestroy();
    jest.useRealTimers();
  }
});
