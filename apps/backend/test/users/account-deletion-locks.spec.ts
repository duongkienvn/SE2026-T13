import type { EntityManager } from 'typeorm';
import {
  lockDeletionResources,
  requireDeletionEligible,
} from '../../src/api/users/account-deletion/account-deletion-locks';

describe('Account deletion resource boundaries', () => {
  it('locks Boards before Workspaces in stable database order', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await lockDeletionResources({ query } as unknown as EntityManager, {
      boards: ['board'],
      workspaces: ['workspace'],
    });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringMatching(/FROM boards .*ORDER BY id FOR UPDATE/),
      expect.stringMatching(/FROM workspaces .*ORDER BY id FOR UPDATE/),
    ]);
  });
  it('returns every blocker category with safe names and untruncated counts', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'board1', name: 'Archived', total: 21 }])
      .mockResolvedValueOnce([{ id: 'board1', name: 'Archived', total: 1 }])
      .mockResolvedValueOnce([{ id: 'team', name: 'Team', total: 1 }]);
    await expect(
      requireDeletionEligible({ query } as unknown as EntityManager, 'user'),
    ).rejects.toMatchObject({
      status: 409,
      blockers: [
        {
          type: 'PERSONAL_WORKSPACE_HAS_BOARDS',
          totalCount: 21,
          resources: [{ id: 'board1', name: 'Archived' }],
        },
        { type: 'BOARD_REQUIRES_ANOTHER_OWNER', totalCount: 1 },
        { type: 'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN', totalCount: 1 },
      ],
    });
    for (const [sql, values] of query.mock.calls) {
      expect(sql).toContain('LIMIT 20');
      expect(sql).not.toContain('is_archived');
      expect(values).toEqual(['user']);
    }
  });
  it('permits removable memberships when all blockers are absent', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await expect(
      requireDeletionEligible({ query } as unknown as EntityManager, 'user'),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(3);
  });
});
