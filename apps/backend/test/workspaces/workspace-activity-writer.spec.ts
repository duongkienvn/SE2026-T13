import type { EntityManager } from 'typeorm';
import { recordWorkspaceActivity } from '../../src/api/workspaces/workspace-activity-writer';

describe('Workspace activity writer', () => {
  it('rejects writes without the business transaction', async () => {
    const manager = {
      queryRunner: { isTransactionActive: false },
    } as unknown as EntityManager;
    await expect(
      recordWorkspaceActivity(manager, {
        workspaceId: 'workspace',
        actorId: 'actor',
        eventType: 'WORKSPACE_CREATED',
      }),
    ).rejects.toThrow('requires a transaction');
  });

  it('uses the supplied manager with no free-form metadata', async () => {
    const insert = jest.fn().mockResolvedValue({});
    const manager = {
      queryRunner: { isTransactionActive: true },
      getRepository: jest.fn().mockReturnValue({ insert }),
    } as unknown as EntityManager;
    const event = {
      workspaceId: 'workspace',
      actorId: 'actor',
      eventType: 'INVITATION_DECLINED' as const,
      id: 'untrusted',
      metadata: { email: 'private@example.test' },
    };
    await recordWorkspaceActivity(manager, event);
    expect(insert).toHaveBeenCalledWith({
      workspaceId: 'workspace',
      actorId: 'actor',
      eventType: 'INVITATION_DECLINED',
      boardId: null,
      boardMoveVersion: null,
    });
  });
});
