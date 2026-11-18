import assert from 'node:assert/strict';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { cpus, totalmem, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { keepAliveTransport } from './keep-alive-transport.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const percentiles = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
};
/** 120 real HTTP logical exports, each with an immediate duplicate POST retry. */
export async function runExportLoad({ baseUrl, token, boardId, source }) {
  const route = `/api/boards/${boardId}/export-jobs`;
  const keys = [];
  const { send, close } = keepAliveTransport(baseUrl, token);
  try {
    async function operation(recordKey = true) {
      const key = randomUUID();
      if (recordKey) keys.push(key);
      const begin = performance.now();
      const start = () => send(route, { format: 'json' }, key);
      const [first, retry] = await Promise.all([start(), start()]);
      assert.equal(first.status, 202, JSON.stringify(first.body));
      assert.equal(retry.status, 202, JSON.stringify(retry.body));
      assert.equal(first.body.id, retry.body.id);
      const ackMs = performance.now() - begin,
        id = first.body.id,
        deadline = Date.now() + 60000;
      let completed = false;
      while (Date.now() < deadline) {
        const response = await send(`${route}/${id}`);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.notEqual(
          response.body.state,
          'FAILED',
          JSON.stringify(response.body),
        );
        if (response.body.state === 'COMPLETED') {
          completed = true;
          break;
        }
        await delay(1000);
      }
      assert.ok(completed, 'Completion observation deadline exceeded');
      const completionMs = performance.now() - begin;
      const file = await send(`${route}/${id}/download`);
      assert.equal(file.status, 200, JSON.stringify(file.body));
      assert.equal(file.body.board.id, boardId);
      return {
        key,
        id,
        ackMs,
        completionMs,
        downloadMs: performance.now() - begin,
      };
    }
    for (let i = 0; i < 5; i++) await operation(false);
    const begun = new Date().toISOString();
    const results = await Promise.allSettled(
      Array.from({ length: 120 }, () => operation()),
    );
    const successes = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    const failures = results
      .filter((result) => result.status === 'rejected')
      .map((result) => String(result.reason));
    const [counts] = await source.query(
      `SELECT count(*)::int AS rows,count(DISTINCT idempotency_key)::int AS logical_operations,
    sum(attempts)::int AS attempts,count(*) FILTER(WHERE state='COMPLETED')::int AS completed
    FROM board_export_jobs WHERE idempotency_key = ANY($1::uuid[])`,
      [keys],
    );
    const label = process.env.VT054_LOAD_LABEL || 'initial';
    assert.match(label, /^[a-z0-9-]+$/);
    const summary = {
      startedAt: begun,
      workload:
        '120 simultaneous independent JSON exports of one synthetic empty Board, each with a simultaneous same-key duplicate POST; 1s status polling; actual JWT, Nest worker, PostgreSQL and download',
      warmup: 5,
      concurrency: 120,
      successes: successes.length,
      failures,
      counts,
      ack: successes.length
        ? percentiles(successes.map((row) => row.ackMs))
        : null,
      completion: successes.length
        ? percentiles(successes.map((row) => row.completionMs))
        : null,
      download: successes.length
        ? percentiles(successes.map((row) => row.downloadMs))
        : null,
      environment: {
        node: process.version,
        transport:
          'Node HTTP keep-alive, 32 sockets, queued time included; no retries in transport',
        v8Profiling: !!process.env.NODE_V8_COVERAGE,
        platform: platform(),
        release: release(),
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        memoryBytes: totalmem(),
        database: 'PostgreSQL 16 disposable local container; pool 10',
        workerConcurrency: 4,
      },
      limitations:
        'Local same-machine empty-Board workload; does not prove large exports, 120 distinct human sessions, WAN latency or production performance. Job identity/attempts are the relevant side effects; exports do not send notifications.',
      samples: successes,
    };
    summary.target = {
      thresholdMs: 3500,
      ack: !!summary.ack && summary.ack.p95 <= 3500,
      completion: !!summary.completion && summary.completion.p95 <= 3500,
    };
    await writeFile(
      `docs/assignments/VT-054/evidence/load-${label}.json`,
      JSON.stringify(summary, null, 2),
    );
    console.log(JSON.stringify({ ...summary, samples: undefined }, null, 2));
    assert.equal(failures.length, 0);
    assert.equal(successes.length, 120);
    assert.equal(counts.rows, 120);
    assert.equal(counts.logical_operations, 120);
    assert.equal(counts.completed, 120);
    assert.equal(counts.attempts, 120);
    assert.ok(summary.target.ack, 'Acknowledgement p95 exceeds 3500ms');
    assert.ok(summary.target.completion, 'Completion p95 exceeds 3500ms');
  } finally {
    close();
  }
}
