import {
  getMetadataArgsStorage,
  type EntityManager,
  type QueryRunner,
} from 'typeorm';
import { UserPushSchedule } from '../../src/api/push/entities/user-push-schedule.entity';
import { PushQuietHours1794873600000 } from '../../src/database/migrations/1794873600000-PushQuietHours';
import { eraseAccountPrivateState } from '../../src/api/users/account-deletion/account-deletion-state';
import type { User } from '../../src/api/users/entities/user.entity';
// Contract checks only: DB constraints/transactions require isolated PostgreSQL.
describe('quiet schedule migration and erasure contract', () => {
  it('creates only the narrow forward-only table, safe defaults, FK and CHECKs', async () => {
    const query = jest.fn();
    const migration = new PushQuietHours1794873600000();
    await migration.up({ query } as unknown as QueryRunner);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain('CREATE TABLE user_push_schedules');
    expect(sql).toContain(
      'user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE',
    );
    expect(sql).toContain('enabled boolean NOT NULL DEFAULT false');
    expect(sql).toContain("start_local varchar(5) NOT NULL DEFAULT '22:00'");
    expect(sql).toContain("end_local varchar(5) NOT NULL DEFAULT '07:00'");
    expect(sql).toContain('NOT enabled OR start_local <> end_local');
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE FROM|DROP TABLE/);
    await expect(migration.down()).rejects.toThrow('forward fix');
    const fields = getMetadataArgsStorage()
      .columns.filter((c) => c.target === UserPushSchedule)
      .map((c) => c.propertyName);
    expect(fields).toEqual([
      'userId',
      'enabled',
      'startLocal',
      'endLocal',
      'createdAt',
      'updatedAt',
    ]);
  });
  it('soft-account erasure explicitly removes schedules without touching shared work', async () => {
    const query = jest.fn(async (sql: string, parameters?: unknown[]) => {
      void sql;
      void parameters;
      return [];
    });
    await eraseAccountPrivateState(
      { query } as unknown as EntityManager,
      { id: 'user', email: 'test@example.test' } as User,
    );
    expect(query).toHaveBeenCalledWith(
      'DELETE FROM user_push_schedules WHERE user_id=$1',
      ['user'],
    );
    expect(query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(
      /DELETE FROM (boards|cards)\b/,
    );
  });
});
