import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearNotificationDetails,
  createNotificationHint,
  notificationKeys,
} from './cache';

afterEach(() => vi.useRealTimers());

const seed = () => {
  const client = new QueryClient();
  const list = notificationKeys.list('u1', 1, 'all', 1, 20);
  const count = notificationKeys.count('u1', 1);
  const prefs = notificationKeys.preferences('u1', 1);
  client.setQueryData(list, { items: [{ summary: 'Secret Board' }] });
  client.setQueryData(count, 3);
  client.setQueryData(prefs, { inApp: {} });
  return { client, list, count, prefs };
};

describe('notification cache', () => {
  it('coalesces a burst of hints into one inbox/count invalidation', () => {
    vi.useFakeTimers();
    const { client } = seed();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const hint = createNotificationHint(client, 100);
    for (let i = 0; i < 25; i++) hint.hint();
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledTimes(1);
    hint.hint();
    hint.cancel();
    vi.advanceTimersByTime(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('invalidates inbox and count but not preferences', () => {
    vi.useFakeTimers();
    const { client, list, count, prefs } = seed();
    createNotificationHint(client, 0).hint();
    vi.advanceTimersByTime(0);
    expect(client.getQueryState(list)?.isInvalidated).toBe(true);
    expect(client.getQueryState(count)?.isInvalidated).toBe(true);
    expect(client.getQueryState(prefs)?.isInvalidated).toBe(false);
  });

  it('drops rendered summaries on access loss but keeps the count', () => {
    const { client, list, count } = seed();
    clearNotificationDetails(client);
    expect(client.getQueryData(list)).toBeUndefined();
    expect(client.getQueryData(count)).toBe(3);
  });
});
