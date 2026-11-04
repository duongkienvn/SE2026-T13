import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { clearProductivity } from './cache';

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
});
