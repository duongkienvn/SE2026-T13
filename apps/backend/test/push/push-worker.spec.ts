import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PushDispatcher } from '../../src/api/push/push-dispatcher.service';
import { PushWorker } from '../../src/api/push/push-worker.service';

describe('push worker lifecycle isolation', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  const setup = (enabled = true) => {
    const dispatcher = {
      drain: jest.fn().mockResolvedValue(undefined),
      releaseOwned: jest.fn().mockResolvedValue(undefined),
    };
    return {
      dispatcher,
      worker: new PushWorker(
        new ConfigService({ PUSH_NOTIFICATIONS_ENABLED: enabled }),
        dispatcher as unknown as PushDispatcher,
      ),
    };
  };
  it('never starts a disabled sender or schedules background polling', async () => {
    jest.useFakeTimers();
    const { worker, dispatcher } = setup(false);
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(dispatcher.drain).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    await worker.onModuleDestroy();
  });
  it('redacts a failed provider cycle and retries only the next bounded poll', async () => {
    jest.useFakeTimers();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { worker, dispatcher } = setup();
    dispatcher.drain.mockRejectedValueOnce(
      new Error('ExpoPushToken[private-routing-material]'),
    );
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(dispatcher.drain).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Push worker cycle failed; leases will recover safely',
    );
    await jest.advanceTimersByTimeAsync(14_999);
    expect(dispatcher.drain).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(dispatcher.drain).toHaveBeenCalledTimes(2);
    await worker.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });
  it('never overlaps cycles and waits for an in-flight decision before releasing leases', async () => {
    jest.useFakeTimers();
    const { worker, dispatcher } = setup();
    let settle!: () => void;
    dispatcher.drain.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          settle = r;
        }),
    );
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(dispatcher.drain).toHaveBeenCalledTimes(1);
    const stopping = worker.onModuleDestroy();
    expect(dispatcher.releaseOwned).not.toHaveBeenCalled();
    settle();
    await stopping;
    expect(dispatcher.releaseOwned).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(dispatcher.drain).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
