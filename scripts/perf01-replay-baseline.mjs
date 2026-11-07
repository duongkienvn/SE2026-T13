import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Replay the existing loopback probes with the audited queue, without a checkout.
const directory = join('apps', 'frontend', 'src', 'features', 'realtime');
const cardsDirectory = join('apps', 'frontend', 'src', 'features', 'cards');
const original = join(directory, 'invalidation-queue.perf01-original.ts');
const probe = join(directory, 'traffic-perf01-original.test.ts');
const originalHook = join(cardsDirectory, 'board-filter.perf01-original.tsx');
const hookProbe = join(
  cardsDirectory,
  'traffic-summary-perf01-original.test.tsx',
);
if ([original, probe, originalHook, hookProbe].some(existsSync))
  throw new Error('Temporary baseline probe paths already exist');

const source = execFileSync('git', [
  'show',
  '9c00f54072958aa8444e89cccc5ea3e24a92aff9:apps/frontend/src/features/realtime/invalidation-queue.ts',
]);
const hookSource = execFileSync('git', [
  'show',
  '9c00f54072958aa8444e89cccc5ea3e24a92aff9:apps/frontend/src/features/cards/board-filter.tsx',
]);
const current = readFileSync(
  join(directory, 'traffic-baseline.test.ts'),
  'utf8',
);
const marker = "it('sends an unrelated Board refresh";
const split = current.indexOf(marker);
if (split < 0) throw new Error('Cross-Board probe not found');
const replace = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`Baseline probe changed: ${from}`);
  return text.replace(from, to);
};
const queueImport = (text) =>
  replace(
    text,
    "'./invalidation-queue'",
    "'./invalidation-queue.perf01-original'",
  );

let mutation = queueImport(current.slice(0, split));
mutation = replace(
  mutation,
  '{ protectedMove: true, expected: 1 }',
  '{ protectedMove: true, expected: 2 }',
);
mutation = replace(
  mutation,
  '      if (!protectedMove) {\n        await vi.waitFor(() => expect(requests).toBe(1));\n        await vi.waitFor(() => expect(client.isFetching()).toBe(0));\n      }\n',
  '',
);
let crossBoard =
  queueImport(current.slice(0, current.indexOf('it.each(['))) +
  current.slice(split);
crossBoard = replace(
  crossBoard,
  "await vi.waitFor(() => expect(requests).toEqual(['/1']));",
  'await new Promise((resolve) => setTimeout(resolve, 100));\n    expect(requests).toEqual([]);',
);
crossBoard = replace(
  crossBoard,
  "expect(requests).toEqual(['/1', '/0'])",
  "expect(requests).toEqual(['/0', '/1'])",
);
crossBoard = replace(
  crossBoard,
  'expect(starts).toEqual([1, 0]);',
  'expect(starts).toEqual([0, 1]);',
);
crossBoard = replace(
  crossBoard,
  "expect([...requests].sort()).toEqual(['/0', '/1'])",
  "expect([...requests].sort()).toEqual(['/0', '/1', '/2'])",
);
crossBoard = replace(
  crossBoard,
  'expect([...starts].sort()).toEqual([0, 1]);',
  'expect([...starts].sort()).toEqual([0, 1, 2]);',
);

let summaryHook = readFileSync(
  join(cardsDirectory, 'traffic-summary-hook.test.tsx'),
  'utf8',
);
summaryHook = replace(
  summaryHook,
  "'./board-filter'",
  "'./board-filter.perf01-original'",
);
summaryHook = replace(
  summaryHook,
  "'../realtime/invalidation-queue'",
  "'../realtime/invalidation-queue.perf01-original'",
);
summaryHook = replace(
  summaryHook,
  'await vi.waitFor(() => expect(requests).toBe(1));',
  'await vi.waitFor(() => expect(requests).toBe(3));',
);
summaryHook = replace(
  summaryHook,
  'expect(starts).toEqual([100]);',
  'expect(starts).toEqual([201]);',
);

let wroteOriginal = false;
let wroteProbe = false;
let wroteHook = false;
let wroteHookProbe = false;
try {
  writeFileSync(original, source, { flag: 'wx' });
  wroteOriginal = true;
  writeFileSync(
    probe,
    mutation + '\n' + crossBoard.slice(crossBoard.indexOf(marker)),
    { flag: 'wx' },
  );
  wroteProbe = true;
  writeFileSync(originalHook, hookSource, { flag: 'wx' });
  wroteHook = true;
  writeFileSync(hookProbe, summaryHook, { flag: 'wx' });
  wroteHookProbe = true;
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(
    pnpm,
    [
      '--filter',
      '@kanban/frontend',
      'exec',
      'vitest',
      'run',
      'src/features/realtime/traffic-perf01-original.test.ts',
      'src/features/cards/traffic-summary-perf01-original.test.tsx',
      '--maxWorkers=1',
    ],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  if (wroteHookProbe) unlinkSync(hookProbe);
  if (wroteHook) unlinkSync(originalHook);
  if (wroteProbe) unlinkSync(probe);
  if (wroteOriginal) unlinkSync(original);
}
