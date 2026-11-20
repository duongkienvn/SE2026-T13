import { DataSource, type EntityManager } from 'typeorm';
import { PushScheduleService } from '../../src/api/push/push-schedule.service';
import { UserPushSchedule } from '../../src/api/push/entities/user-push-schedule.entity';
import { UserPreferences } from '../../src/api/users/entities/user-preferences.entity';
import { User } from '../../src/api/users/entities/user.entity';
const session = { userId: 'user', authVersion: 2, expiresAt: 9999999999999 };
const defaults = {
  enabled: false,
  startLocal: '22:00',
  endLocal: '07:00',
  timeZone: 'UTC',
};
describe('account push schedule persistence', () => {
  let row: Record<string, unknown> | null;
  let zone: string | undefined;
  let user: Record<string, unknown> | null;
  const save = jest.fn();
  const lock = jest.fn();
  const repo = {
    findOneBy: async () => row,
    create: (value: unknown) => value,
    save,
  };
  const manager = {
    getRepository(entity: unknown) {
      if (entity === UserPushSchedule) return repo;
      if (entity === UserPreferences)
        return { findOneBy: async () => (zone ? { timeZone: zone } : null) };
      if (entity === User) return { findOne: lock };
      throw new Error('Unexpected repository');
    },
  };
  const transaction = jest.fn(async (run: (m: EntityManager) => unknown) =>
    run(manager as unknown as EntityManager),
  );
  const source = { ...manager, manager, transaction } as unknown as DataSource;
  const service = new PushScheduleService(source);
  beforeEach(() => {
    jest.clearAllMocks();
    row = null;
    zone = undefined;
    user = { authVersion: 2, emailVerifiedAt: new Date(), deletedAt: null };
    lock.mockImplementation(async () => user);
    save.mockImplementation(async (value) => {
      row = value;
      return value;
    });
  });
  it('GET defaults performs no transaction/write, and reads existing account timezone', async () => {
    expect(await service.get('user')).toEqual(defaults);
    zone = 'Pacific/Kiritimati';
    expect(await service.get('user')).toEqual({ ...defaults, timeZone: zone });
    expect(save).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
  it('no-op default PATCH does not create a row; sparse changes merge atomically', async () => {
    expect(await service.update(session, { enabled: false })).toEqual(defaults);
    expect(save).not.toHaveBeenCalled();
    expect(await service.update(session, { enabled: true })).toEqual({
      ...defaults,
      enabled: true,
    });
    expect(
      await service.update(session, { startLocal: '07:15', endLocal: '07:00' }),
    ).toEqual({ ...defaults, enabled: true, startLocal: '07:15' });
    expect(lock).toHaveBeenCalledWith({
      where: { id: 'user' },
      lock: { mode: 'for_no_key_update' },
    });
  });
  it('validates the effective pair, allowing equal clocks only while disabled', async () => {
    await service.update(session, { startLocal: '07:00' });
    await expect(
      service.update(session, { enabled: true }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await service.update(session, { enabled: true, endLocal: '06:45' }),
    ).toMatchObject({ enabled: true, startLocal: '07:00', endLocal: '06:45' });
    await expect(
      service.update(session, { endLocal: '07:00' }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('rejects empty changes and never recreates state for stale/deleted sessions', async () => {
    await expect(service.update(session, {})).rejects.toMatchObject({
      status: 400,
    });
    for (const invalid of [
      null,
      { ...user, deletedAt: new Date() },
      { ...user, authVersion: 3 },
    ]) {
      user = invalid;
      await expect(
        service.update(session, { enabled: true }),
      ).rejects.toMatchObject({ status: 401 });
    }
    expect(save).not.toHaveBeenCalled();
  });
  it('reads the authoritative timezone at update without persisting a second timezone', async () => {
    zone = 'America/New_York';
    expect(await service.update(session, { enabled: true })).toMatchObject({
      timeZone: zone,
    });
    expect(save.mock.calls[0][0]).not.toHaveProperty('timeZone');
    zone = 'Asia/Tokyo';
    expect(await service.get('user')).toMatchObject({
      timeZone: zone,
      startLocal: '22:00',
    });
  });
});
