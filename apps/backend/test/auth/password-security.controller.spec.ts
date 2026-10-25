import { Inject } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { PasswordSecurityController } from '../../src/api/auth/password-security.controller';
import { PasswordSecurityService } from '../../src/api/auth/password-security.service';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => Inject('UserRepository'),
}));
jest.mock('node:timers/promises', () => ({ setTimeout: jest.fn() }));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

// Let promise continuations (including the detached catch) settle without fake
// clocks: the response timer itself is an explicitly controlled separate gate.
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('forgot-password response timing boundary', () => {
  const email = 'person@example.test';
  let timer: ReturnType<typeof deferred>;
  let send: jest.Mock;
  let controller: PasswordSecurityController;
  beforeEach(() => {
    timer = deferred();
    jest.mocked(delay).mockReturnValue(timer.promise);
    send = jest.fn();
    controller = new PasswordSecurityController({
      send,
    } as unknown as PasswordSecurityService);
  });
  it('acknowledges on the timer while delivery is still pending, then allows eventual delivery', async () => {
    const delivery = deferred();
    send.mockReturnValue(delivery.promise);
    let finished = false;
    const response = controller.forgot({ email }).then((value) => {
      finished = true;
      return value;
    });
    await nextTurn();
    expect(delay).toHaveBeenCalledWith(10_500);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(email);
    expect(finished).toBe(false);
    timer.resolve();
    await expect(response).resolves.toBeNull();
    // The job remains alive after acknowledgement; it is not cancelled/retried.
    delivery.resolve();
    await nextTurn();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([
    'ineligible',
    'delivered',
    'database rejection',
    'synchronous throw',
  ])('waits for the same timer for %s', async (outcome) => {
    send.mockImplementation(() => {
      if (outcome === 'synchronous throw')
        throw new Error('private failure details');
      return outcome === 'database rejection'
        ? Promise.reject(new Error('private failure details'))
        : Promise.resolve();
    });
    let finished = false;
    const response = controller.forgot({ email }).then((value) => {
      finished = true;
      return value;
    });
    await nextTurn();
    expect(finished).toBe(false);
    timer.resolve();
    await expect(response).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(['transaction', 'provider', 'final token update'])(
    'handles a late %s rejection after the HTTP result without logging or retrying',
    async () => {
      const job = deferred();
      send.mockReturnValue(job.promise);
      const errorLog = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const warningLog = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        const response = controller.forgot({ email });
        timer.resolve();
        await expect(response).resolves.toBeNull();
        job.reject(new Error('private failure details'));
        await nextTurn();
        expect(errorLog).not.toHaveBeenCalled();
        expect(warningLog).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledTimes(1);
      } finally {
        errorLog.mockRestore();
        warningLog.mockRestore();
      }
    },
  );
});
