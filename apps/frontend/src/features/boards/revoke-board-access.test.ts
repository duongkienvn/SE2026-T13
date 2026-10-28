import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { workspaceKeys } from '../workspaces/query-keys';
import { boardKeys } from './query-keys';
import { revokeBoardAccess } from './revoke-board-access';

describe('Board access loss in Workspace caches', () => {
  it('hides cached pages and totals before rechecking grants, preserving independent Workspace membership', () => {
    const client = new QueryClient();
    const overviewKey = workspaceKeys.overview('user', 3, 'workspace');
    const boardsKey = workspaceKeys.boards('user', 3, 'workspace');
    const directoryKey = workspaceKeys.list('user', 3);
    client.setQueryData(directoryKey, [
      { id: 'workspace', name: 'Member workspace' },
    ]);
    client.setQueryData(overviewKey, {
      visibleBoardCount: 22,
      recentBoards: [{ id: 'revoked', name: 'Protected Board' }],
    });
    client.setQueryData([...boardsKey, { page: 1 }], { total: 22, items: [] });
    client.setQueryData([...boardsKey, { page: 2 }], {
      total: 22,
      items: [{ id: 'revoked', name: 'Protected Board' }],
    });
    client.setQueryData(boardKeys.detail('revoked'), {
      name: 'Protected Board',
    });

    revokeBoardAccess(client, 'revoked');

    for (const query of client
      .getQueryCache()
      .findAll({ queryKey: workspaceKeys.resource('user', 3, 'workspace') })) {
      expect(query.state.data).toBeNull();
      expect(query.state.status).toBe('error');
      expect(query.state.isInvalidated).toBe(true);
    }
    expect(client.getQueryData(directoryKey)).toEqual([
      { id: 'workspace', name: 'Member workspace' },
    ]);
    expect(client.getQueryData(boardKeys.detail('revoked'))).toBeUndefined();
    client.clear();
  });
});
