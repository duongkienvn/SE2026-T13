import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import {
  WelcomeOnboardingService,
  WELCOME_RETRY_WINDOW_MS,
} from '../../src/api/auth/welcome-onboarding.service';
import { WelcomeEmailDelivery } from '../../src/api/auth/entities/welcome-email-delivery.entity';
import { User } from '../../src/api/users/entities/user.entity';
import { EnvironmentConfig } from '../../src/config/environment';
import { welcomeEmail } from '../../src/mail/welcome-email';

describe('welcome onboarding delivery boundary', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const config = new ConfigService<EnvironmentConfig, true>({
    PUBLIC_APP_URL: 'https://example.test',
    MAIL_FROM: 'Kanvexa <no-reply@example.test>',
  } as EnvironmentConfig);
  let row: WelcomeEmailDelivery | null;
  let service: WelcomeOnboardingService;
  let inTransaction: boolean;
  const repository = {
    insert: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const query = {
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    setLock: jest.fn(),
    setOnLocked: jest.fn(),
    getOne: jest.fn(),
  };
  const manager = {
    queryRunner: { isTransactionActive: true },
    getRepository: jest.fn(() => repository),
    query: jest.fn(async () => [{ now }]),
  };
  const mailer = { send: jest.fn() };
  let log: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    inTransaction = false;
    row = Object.assign(new WelcomeEmailDelivery(), {
      userId: 'user',
      readyAt: now,
      firstAttemptAt: null,
      attempts: 0,
      leaseToken: null,
      leaseUntil: null,
      sentAt: null,
      stoppedAt: null,
      message: {
        from: 'Kanvexa <no-reply@example.test>',
        to: 'new@example.test',
        ...welcomeEmail('https://example.test'),
      },
    });
    for (const key of [
      'addSelect',
      'where',
      'andWhere',
      'orderBy',
      'addOrderBy',
      'setLock',
      'setOnLocked',
    ] as const)
      query[key].mockReturnValue(query);
    query.getOne.mockImplementation(async () => row);
    repository.createQueryBuilder.mockReturnValue(query);
    repository.save.mockImplementation(async (value) => value);
    repository.update.mockResolvedValue({ affected: 1 });
    mailer.send.mockImplementation(async () => {
      expect(inTransaction).toBe(false);
    });
    const source = {
      getRepository: () => repository,
      transaction: async (
        work: (manager: EntityManager) => Promise<unknown>,
      ) => {
        inTransaction = true;
        try {
          return await work(manager as unknown as EntityManager);
        } finally {
          inTransaction = false;
        }
      },
    } as unknown as DataSource;
    service = new WelcomeOnboardingService(source, mailer, config);
    log = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  it('records pending eligibility without enabling unverified accounts', async () => {
    const user = { id: 'new', emailVerifiedAt: null } as User;
    await service.enroll(manager as unknown as EntityManager, user);
    await service.ready(manager as unknown as EntityManager, user);
    expect(repository.insert).toHaveBeenCalledWith({ userId: 'new' });
    expect(repository.update).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('freezes the configured sender, recipient and rendered body when verified', async () => {
    const user = {
      id: 'new',
      email: 'new@example.test',
      emailVerifiedAt: now,
    } as User;
    await service.enroll(manager as unknown as EntityManager, user);
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'new' }),
      { readyAt: now, message: row!.message },
    );
    expect(mailer.send).not.toHaveBeenCalled();
    await expect(service.enroll({} as EntityManager, user)).rejects.toThrow(
      'active account transaction',
    );
  });

  it('commits the lease before delivery, then records acceptance with a lease fence', async () => {
    await service.deliverPending('user');
    expect(query.setOnLocked).toHaveBeenCalledWith('skip_locked');
    expect(mailer.send).toHaveBeenCalledWith(row!.message, 'welcome/user');
    expect(row!.attempts).toBe(1);
    expect(row!.firstAttemptAt).toEqual(now);
    expect(repository.update).toHaveBeenCalledWith(
      { userId: 'user', leaseToken: row!.leaseToken },
      expect.objectContaining({
        sentAt: expect.any(Function),
        leaseToken: null,
      }),
    );
  });

  it('retains the frozen payload/key and schedules backoff on ambiguous provider failure', async () => {
    mailer.send.mockRejectedValue(
      new Error('SECRET recipient provider details'),
    );
    await expect(service.deliverPending('user')).resolves.toBeUndefined();
    expect(row!.nextAttemptAt.getTime() - now.getTime()).toBe(60_000);
    expect(repository.update.mock.calls[0][1]).not.toHaveProperty('sentAt');
    await service.deliverPending('user');
    expect(row!.attempts).toBe(2);
    expect(row!.nextAttemptAt.getTime() - now.getTime()).toBe(120_000);
    expect(mailer.send.mock.calls[0]).toEqual(mailer.send.mock.calls[1]);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET|new@example/);
  });

  it('stops retries before the provider key can expire', async () => {
    row!.firstAttemptAt = new Date(now.getTime() - WELCOME_RETRY_WINDOW_MS);
    await service.deliverPending('user');
    expect(row!.stoppedAt).toEqual(now);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('isolates storage errors after provider acceptance and during claim from auth', async () => {
    repository.update.mockRejectedValueOnce(new Error('SECRET SQL'));
    await expect(service.deliverPending('user')).resolves.toBeUndefined();
    query.getOne.mockRejectedValueOnce(new Error('SECRET connection'));
    await expect(service.deliverPending('user')).resolves.toBeUndefined();
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
  });

  it('does nothing when no eligible committed record can be claimed', async () => {
    row = null;
    await service.deliverPending('user');
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('keeps shutdown safe when a database claim fails during bootstrap', async () => {
    query.getOne.mockRejectedValueOnce(new Error('Synthetic missing table'));
    service.onApplicationBootstrap();
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('recovers pending work at startup and on the periodic sweep', async () => {
    jest.useFakeTimers();
    row = null;
    try {
      service.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(0);
      expect(query.getOne).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(30_000);
      expect(query.getOne).toHaveBeenCalledTimes(2);
      await service.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(30_000);
      expect(query.getOne).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('prevents overlapping drains and waits for active work on shutdown', async () => {
    let release!: () => void;
    mailer.send.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = service.deliverPending('user');
    while (!release) await Promise.resolve();
    await service.deliverPending('user');
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const shutdown = service.onModuleDestroy();
    release();
    await Promise.all([first, shutdown]);
    await service.deliverPending('user');
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });
});
