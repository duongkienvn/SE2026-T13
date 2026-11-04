import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { clearProductivity } from './cache';
import { invalidationTargets } from '../realtime/event-invalidation';

describe('productivity access changes', () => {
  it('clears protected aggregate data and cancels in-flight requests', async () => {
    const client = new QueryClient();
    const key = ['productivity', 'user', 1, 'tasks', {}];
    client.setQueryData(key, { data: [{ title: 'Private card' }] });
    let aborted = false;
    const pending = client
      .fetchQuery({
        queryKey: key,
        queryFn: ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
          }),
      })
      .catch(() => undefined);
    clearProductivity(client);
    expect(client.getQueryData(key)).toBeUndefined();
    await pending;
    expect(aborted).toBe(true);
    expect(client.getQueryData(key)).toBeUndefined();
    client.clear();
  });

  it('does not restore a late response whose transport ignores abort', async () => {
    const client = new QueryClient();
    const key = ['productivity', 'user', 1, 'tasks', {}];
    let finish!: (value: unknown) => void;
    const response = new Promise((resolve) => {
      finish = resolve;
    });
    const pending = client
      .fetchQuery({ queryKey: key, queryFn: () => response })
      .catch(() => undefined);
    clearProductivity(client);
    finish({ data: [{ title: 'Revoked card' }] });
    await pending;
    expect(client.getQueryData(key)).toBeUndefined();
    client.clear();
  });

  it('refreshes task aggregates for Card and label events', () => {
    expect(
      invalidationTargets('card:assignees-changed', {
        boardId: 'board',
        cardId: 'card',
        columnId: 'column',
      }),
    ).toContainEqual({ queryKey: ['productivity'] });
    expect(
      invalidationTargets('labels:changed', {
        boardId: 'board',
        labelId: 'label',
      }),
    ).toContainEqual({ queryKey: ['productivity'] });
  });
});
