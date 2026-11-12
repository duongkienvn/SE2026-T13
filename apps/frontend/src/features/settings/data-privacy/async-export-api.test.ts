import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../../../test/mock-api';
import { exportBoardDataAsync } from './async-export-api';

const board = '291da68b-c50b-42cc-ad8d-3151ea006622';
const id = '4da6b7b2-61b7-4890-acb9-0a2538030044';
const key = '39725ab4-df2b-4ffd-b048-1c2db7006633';
const path = `/boards/${board}/export-jobs`;
const job = (state: string) => ({
  id,
  state,
  format: 'json',
  attempts: 1,
  expiresAt: '2026-11-12T12:15:00Z',
  progress: state === 'COMPLETED' ? 100 : null,
  error: state === 'FAILED' ? 'EXPORT_FAILED' : null,
});
const json = (state: string, status = 200) => ({ status, body: job(state) });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('VT-054 async Board export API workflow', () => {
  it('TC14: follows queued/running/completed states then downloads only the completed job', async () => {
    vi.useFakeTimers();
    let polls = 0;
    const calls = mockApi({
      [`POST ${path}`]: json('PENDING', 202),
      [`GET ${path}/${id}`]: () =>
        json(++polls === 1 ? 'RUNNING' : 'COMPLETED'),
      [`GET ${path}/${id}/download`]: { status: 200, raw: '{"board":{}}' },
    });
    const phase = vi.fn();
    const promise = exportBoardDataAsync(
      'token',
      board,
      'json',
      key,
      new AbortController().signal,
      phase,
    );
    const observed = promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await vi.runAllTimersAsync();
    expect(await observed).toMatchObject({ value: { blob: expect.any(Blob) } });
    expect(phase.mock.calls.map(([value]) => value)).toEqual([
      'queued',
      'running',
      'downloading',
    ]);
    expect(calls[0].headers['Idempotency-Key']).toBe(key);
    expect(calls[0].body).toEqual({ format: 'json' });
    expect(calls.at(-1)?.path).toBe(`${path}/${id}/download`);
  });
  it('TC10/14: explicit user retry reuses a failed job identity', async () => {
    const calls = mockApi({
      [`POST ${path}`]: json('FAILED', 202),
      [`POST ${path}/${id}/retry`]: json('COMPLETED', 202),
      [`GET ${path}/${id}/download`]: { status: 200, raw: '{}' },
    });
    await exportBoardDataAsync(
      'token',
      board,
      'json',
      key,
      new AbortController().signal,
    );
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `POST ${path}`,
      `POST ${path}/${id}/retry`,
      `GET ${path}/${id}/download`,
    ]);
  });
  it('TC15: an already-aborted session starts no network operation', async () => {
    const calls = mockApi({});
    const abort = new AbortController();
    abort.abort();
    await expect(
      exportBoardDataAsync('token', board, 'json', key, abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(0);
  });
  it('TC06: authorization failure stops polling and never downloads', async () => {
    const calls = mockApi({
      [`POST ${path}`]: {
        status: 401,
        body: { success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' },
      },
    });
    await expect(
      exportBoardDataAsync(
        'token',
        board,
        'json',
        key,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(1);
  });
});
