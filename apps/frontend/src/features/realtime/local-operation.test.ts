import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  beginCommentOperation,
  clearLocalOperations,
  consumeCommentHint,
} from './local-operation';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('suppresses only the matching tab hint after a successful refresh', () => {
  const local = new QueryClient();
  const otherTab = new QueryClient();
  const enqueue = vi.fn();
  const operation = beginCommentOperation(
    local,
    'comment:created',
    'board',
    'card',
  )!;
  const payload = {
    boardId: 'board',
    cardId: 'card',
    operationId: operation.id,
  };
  const targets = [{ queryKey: ['comments'] }];
  expect(
    consumeCommentHint(otherTab, 'comment:created', payload, targets, enqueue),
  ).toBe(false);
  expect(
    consumeCommentHint(
      local,
      'comment:created',
      { ...payload, cardId: 'other' },
      targets,
      enqueue,
    ),
  ).toBe(false);
  expect(
    consumeCommentHint(local, 'comment:created', payload, targets, enqueue),
  ).toBe(true);
  operation.success();
  expect(enqueue).not.toHaveBeenCalled();
  expect(
    consumeCommentHint(local, 'comment:created', payload, targets, enqueue),
  ).toBe(false);
  clearLocalOperations(local);
});

it('replays a buffered hint on failed mutation or expiry', async () => {
  const client = new QueryClient();
  const enqueue = vi.fn();
  const targets = [{ queryKey: ['comments'] }];
  const first = beginCommentOperation(
    client,
    'comment:created',
    'board',
    'card',
  )!;
  const hint = (id: string) =>
    consumeCommentHint(
      client,
      'comment:created',
      { boardId: 'board', cardId: 'card', operationId: id },
      targets,
      enqueue,
    );
  expect(hint(first.id)).toBe(true);
  first.failure();
  expect(enqueue).toHaveBeenCalledTimes(1);
  const second = beginCommentOperation(
    client,
    'comment:created',
    'board',
    'card',
  )!;
  expect(hint(second.id)).toBe(true);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(enqueue).toHaveBeenCalledTimes(2);
  clearLocalOperations(client);
});

it('suppresses a late matching hint once and discards pending hints on session disposal', () => {
  const client = new QueryClient();
  const enqueue = vi.fn();
  const targets = [{ queryKey: ['comments'] }];
  const operation = beginCommentOperation(
    client,
    'comment:deleted',
    'board',
    'card',
  )!;
  operation.success();
  const payload = {
    boardId: 'board',
    cardId: 'card',
    operationId: operation.id,
  };
  expect(
    consumeCommentHint(client, 'comment:deleted', payload, targets, enqueue),
  ).toBe(true);
  expect(
    consumeCommentHint(client, 'comment:deleted', payload, targets, enqueue),
  ).toBe(false);
  const pending = beginCommentOperation(
    client,
    'comment:created',
    'board',
    'card',
  )!;
  expect(
    consumeCommentHint(
      client,
      'comment:created',
      { ...payload, operationId: pending.id },
      targets,
      enqueue,
    ),
  ).toBe(true);
  clearLocalOperations(client);
  pending.failure();
  expect(enqueue).not.toHaveBeenCalled();
});

it('keeps simultaneous operations independent and never suppresses an uncorrelated hint', () => {
  const client = new QueryClient();
  const enqueue = vi.fn();
  const targets = [{ queryKey: ['comments'] }];
  const first = beginCommentOperation(
    client,
    'comment:created',
    'board',
    'card',
  )!;
  const second = beginCommentOperation(
    client,
    'comment:created',
    'board',
    'card',
  )!;
  expect(first.id).not.toBe(second.id);
  const hint = (id?: string) =>
    consumeCommentHint(
      client,
      'comment:created',
      { boardId: 'board', cardId: 'card', operationId: id },
      targets,
      enqueue,
    );
  expect(hint(first.id)).toBe(true);
  expect(hint()).toBe(false);
  expect(hint(second.id)).toBe(true);
  first.success();
  second.failure();
  expect(enqueue).toHaveBeenCalledTimes(1);
  clearLocalOperations(client);
});
