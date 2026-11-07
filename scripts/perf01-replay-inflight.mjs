import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Replay the same loopback probe against the queue before this fix.
const directory = join('apps', 'frontend', 'src', 'features', 'realtime');
const queue = join(directory, 'invalidation-queue.perf01-inflight-before.ts');
const probe = join(directory, 'inflight-perf01-before.test.ts');
if ([queue, probe].some(existsSync))
  throw new Error('Temporary probe path exists');
const original = execFileSync('git', [
  'show',
  '56ddced:apps/frontend/src/features/realtime/invalidation-queue.ts',
]);
const current = readFileSync(
  join(directory, 'inflight-traffic.test.ts'),
  'utf8',
);
const expected = 'starts: 1,\n      cancellations: 0,\n      requests: 1,';
if (!current.includes(expected)) throw new Error('Probe expectations changed');
const baseline = current
  .replace(
    "'./invalidation-queue'",
    "'./invalidation-queue.perf01-inflight-before'",
  )
  .replace(expected, 'starts: 2,\n      cancellations: 1,\n      requests: 2,');
let wroteQueue = false;
let wroteProbe = false;
try {
  writeFileSync(queue, original, { flag: 'wx' });
  wroteQueue = true;
  writeFileSync(probe, baseline, { flag: 'wx' });
  wroteProbe = true;
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(
    pnpm,
    [
      '--filter',
      '@kanban/frontend',
      'exec',
      'vitest',
      'run',
      'src/features/realtime/inflight-perf01-before.test.ts',
      '--maxWorkers=1',
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  if (wroteProbe) unlinkSync(probe);
  if (wroteQueue) unlinkSync(queue);
}
