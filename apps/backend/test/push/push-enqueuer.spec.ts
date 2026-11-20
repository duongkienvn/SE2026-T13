import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { PushEnqueuer } from '../../src/api/push/push-enqueuer.service';
describe('transactional push fanout', () => {
  it('does no work while disabled', async () => {
    const manager = { query: jest.fn() };
    await new PushEnqueuer(
      new ConfigService({ PUSH_NOTIFICATIONS_ENABLED: false }),
    ).enqueue(manager as unknown as EntityManager, 'n', 'u');
    expect(manager.query).not.toHaveBeenCalled();
  });
  it('inserts using the caller transaction and no provider I/O', async () => {
    const manager = { query: jest.fn().mockResolvedValue([]) };
    await new PushEnqueuer(
      new ConfigService({
        PUSH_NOTIFICATIONS_ENABLED: true,
        PUSH_PROJECT_ID: 'p',
        PUSH_APP_ENVIRONMENT: 'preview',
      }),
    ).enqueue(manager as unknown as EntityManager, 'n', 'u');
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      ['n', 'u', 'p', 'preview'],
    );
    expect(manager.query.mock.calls[0][0]).toContain(
      'lease_until>clock_timestamp()',
    );
  });
});
