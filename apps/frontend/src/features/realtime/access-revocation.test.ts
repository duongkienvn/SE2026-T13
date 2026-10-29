import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  receiveBoardRevocation,
  receiveWorkspaceRevocation,
  reduceBoardToReadOnly,
} from './access-revocation';
import { boardKeys } from '../boards/query-keys';
import { workspaceKeys } from '../workspaces/query-keys';
import { makeBoard } from '../../test/board-fixtures';
import { activityKeys } from '../activities/query-keys';

describe('access-loss cache isolation', () => {
  it('prevents an in-flight privileged Activity read from restoring cleared history', async () => {
    const client = new QueryClient();
    const board = makeBoard({ id: 'ABCD' });
    const key = activityKeys.page(board.id, 1);
    const history = {
      items: [{ entityType: 'MEMBER', metadata: { fromRole: 'OWNER' } }],
    };
    client.setQueryData(boardKeys.detail(board.id), board);
    client.setQueryData(key, history);
    let complete: () => void = () => undefined;
    const response = new Promise<typeof history>((resolve) => {
      complete = () => resolve(history);
    });
    const request = client
      .fetchQuery({ queryKey: key, queryFn: () => response })
      .catch(() => undefined);
    reduceBoardToReadOnly(client, 'abcd');
    complete();
    await request;
    expect(client.getQueryData(key)).toBeUndefined();
    client.clear();
  });
  it('clears member profiles and disables editing when an independent read grant remains', () => {
    const client = new QueryClient();
    const board = makeBoard({ id: 'ABCD', currentUserRole: 'MEMBER' });
    client.setQueryData(boardKeys.detail(board.id), board);
    client.setQueryData(boardKeys.members(board.id), [{ email: 'Protected' }]);
    client.setQueryData(activityKeys.page(board.id, 1), {
      items: [{ entityType: 'MEMBER', metadata: { fromRole: 'OWNER' } }],
    });
    reduceBoardToReadOnly(client, 'abcd');
    expect(client.getQueryData(boardKeys.detail(board.id))).toMatchObject({
      currentUserRole: null,
      capabilities: { canWriteBoard: false },
    });
    expect(client.getQueryData(boardKeys.members(board.id))).toBeUndefined();
    expect(client.getQueryData(activityKeys.page(board.id, 1))).toBeUndefined();
    client.clear();
  });
  it('clears uppercase Board URLs, nested cards and Workspace aggregates', () => {
    const client = new QueryClient();
    const board = 'ABCD';
    client.setQueryData(boardKeys.detail(board), { name: 'Protected' });
    client.setQueryData(boardKeys.card(board, 'card'), { title: 'Protected' });
    const overview = workspaceKeys.overview('user', 1, 'team');
    client.setQueryData(overview, { recentBoards: ['Protected'] });
    receiveBoardRevocation(client, { boardId: 'abcd' });
    expect(client.getQueryData(boardKeys.detail(board))).toBeUndefined();
    expect(client.getQueryData(boardKeys.card(board, 'card'))).toBeUndefined();
    expect(client.getQueryData(overview)).toBeNull();
    client.clear();
  });

  it('clears Workspace resources while retaining independent Guest Board access', () => {
    const client = new QueryClient();
    const key = workspaceKeys.overview('user', 1, 'team');
    const other = workspaceKeys.overview('user', 1, 'other');
    client.setQueryData(key, { secret: true });
    client.setQueryData(other, { name: 'Other' });
    client.setQueryData(boardKeys.detail('guest'), { name: 'Guest Board' });
    receiveWorkspaceRevocation(client, { workspaceId: 'TEAM' });
    expect(client.getQueryData(key)).toBeNull();
    expect(client.getQueryData(other)).toEqual({ name: 'Other' });
    expect(client.getQueryData(boardKeys.detail('guest'))).toEqual({
      name: 'Guest Board',
    });
    client.clear();
  });
});
