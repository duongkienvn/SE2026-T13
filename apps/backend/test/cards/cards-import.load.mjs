// VT-052 load check: 100 concurrent users each POST one bulk import through the
// real AppModule (JWT guard, ValidationPipe, envelopes, PostgreSQL) and compare
// p95 with the 3.0 s target. Run from apps/backend: pnpm test:cards-import:load
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { PASSWORD, withImportDatabase } from './cards-import.setup.mjs';

const require = createRequire(import.meta.url);
const { Test } = require('@nestjs/testing');
const { JwtService } = require('@nestjs/jwt');
const { DataSource } = require('typeorm');

const USERS = Number(process.env.LOAD_USERS ?? 100);
const ROWS = Number(process.env.LOAD_ROWS ?? 20);
const RUNS = Number(process.env.LOAD_RUNS ?? 3);
const TARGET_P95_MS = 3000;
const { fetch } = globalThis;

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
};
// Deterministic test data: every 10th row is invalid (blank title).
const items = (user) =>
  Array.from({ length: ROWS }, (_, row) =>
    row % 10 === 9
      ? { title: '' }
      : { title: `u${user}-r${row}`, description: 'Imported by load test' },
  );

await withImportDatabase('kanban_import_load', async (ctx) => {
  const { repos } = ctx;
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_NAME: ctx.database,
    JWT_SECRET: randomBytes(32).toString('hex'),
    LOG_LEVEL: 'silent',
    API_PREFIX: 'api',
    // One client IP sends every request here; production keeps its own limit.
    RATE_LIMIT_MAX: '10000',
  });
  const { AppModule } = require('../../dist/app.module.js');
  const {
    configureHttpApplication,
  } = require('../../dist/http-application.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(ctx.source)
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  ctx.onClose(() => app.close());
  const origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;

  const users = [];
  for (let index = 0; index < USERS; index++)
    users.push(await ctx.user(`load${index}`));
  // One real REST login proves the auth path; the rest are signed with the
  // same JwtService/claims to stay under the login throttle (10/min).
  const login = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: users[0].email, password: PASSWORD }),
  });
  if (login.status !== 200) throw new Error(`login ${login.status}`);
  const jwt = app.get(JwtService);
  const tokens = [(await login.json()).data.accessToken];
  for (const user of users.slice(1))
    tokens.push(await jwt.signAsync({ sub: user.id, authVersion: 0 }));

  const setup = async (boardCount) => {
    const columns = [];
    for (let b = 0; b < boardCount; b++) {
      const members = users.filter((_, index) => index % boardCount === b);
      const board = await ctx.board(`Load ${b}`, members[0], members.slice(1));
      const column = await ctx.columnService.create(members[0].id, board.id, {
        name: 'Imported',
      });
      columns.push({ boardId: board.id, columnId: column.id });
    }
    return columns;
  };
  const post = async (user, target) => {
    const started = performance.now();
    const response = await fetch(
      `${origin}/api/boards/${target.boardId}/cards/import`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${tokens[user]}`,
        },
        body: JSON.stringify({ columnId: target.columnId, items: items(user) }),
      },
    );
    const body = await response.json();
    return {
      ms: performance.now() - started,
      status: response.status,
      created: body.data?.createdCount ?? 0,
      rejected: body.data?.rejectedCount ?? 0,
    };
  };
  const read = async (user, target) => {
    const started = performance.now();
    const response = await fetch(
      `${origin}/api/boards/${target.boardId}/cards?columnId=${target.columnId}&limit=100`,
      { headers: { authorization: `Bearer ${tokens[user]}` } },
    );
    await response.arrayBuffer();
    return { ms: performance.now() - started, status: response.status };
  };

  const scenarios = [
    { name: 'A: 100 users spread over 10 boards', boards: 10 },
    { name: 'B: 100 users on 1 hot board (worst-case lock)', boards: 1 },
  ];
  const report = {
    environment: {
      node: process.version,
      cpus: cpus().length,
      cpuModel: cpus()[0]?.model,
      memoryGb: Math.round(totalmem() / 2 ** 30),
      users: USERS,
      rowsPerRequest: ROWS,
      invalidRowsPerRequest: Math.floor(ROWS / 10),
      runs: RUNS,
      targetP95Ms: TARGET_P95_MS,
    },
    scenarios: [],
  };
  // Warm-up outside the measurement (JIT, pool, first query plans).
  const warm = await setup(1);
  for (let index = 0; index < 5; index++) await post(0, warm[0]);
  const idle = [];
  for (let index = 0; index < 20; index++)
    idle.push((await read(0, warm[0])).ms);
  report.idleReadP95Ms = Math.round(percentile(idle, 95));
  console.log(`idle read p95 (no import load): ${report.idleReadP95Ms}ms`);

  for (const scenario of scenarios) {
    for (let run = 1; run <= RUNS; run++) {
      const targets = await setup(scenario.boards);
      const before = await repos.cards.count();
      const started = performance.now();
      const [imports, reads] = await Promise.all([
        Promise.all(
          users.map((_, user) => post(user, targets[user % targets.length])),
        ),
        // Unrelated old behaviour measured under the same load.
        Promise.all(
          Array.from({ length: 20 }, (_, index) =>
            read(index * 5, targets[(index * 5) % targets.length]),
          ),
        ),
      ]);
      const wallMs = performance.now() - started;
      const latencies = imports.map((r) => r.ms);
      const persisted = (await repos.cards.count()) - before;
      const expectedCreated = USERS * (ROWS - Math.floor(ROWS / 10));
      const row = {
        scenario: scenario.name,
        run,
        ok: imports.filter((r) => r.status === 200).length,
        errors: imports.filter((r) => r.status !== 200).length,
        createdReported: imports.reduce((sum, r) => sum + r.created, 0),
        rejectedReported: imports.reduce((sum, r) => sum + r.rejected, 0),
        persisted,
        expectedCreated,
        p50Ms: Math.round(percentile(latencies, 50)),
        p95Ms: Math.round(percentile(latencies, 95)),
        maxMs: Math.round(Math.max(...latencies)),
        wallMs: Math.round(wallMs),
        readP95Ms: Math.round(
          percentile(
            reads.map((r) => r.ms),
            95,
          ),
        ),
        readErrors: reads.filter((r) => r.status !== 200).length,
      };
      row.meetsTarget =
        row.errors === 0 &&
        row.persisted === expectedCreated &&
        row.p95Ms <= TARGET_P95_MS;
      report.scenarios.push(row);
      console.log(
        `${row.scenario} run ${run}: ok=${row.ok} errors=${row.errors} persisted=${row.persisted}/${expectedCreated} ` +
          `p50=${row.p50Ms}ms p95=${row.p95Ms}ms max=${row.maxMs}ms wall=${row.wallMs}ms ` +
          `readP95=${row.readP95Ms}ms -> ${row.meetsTarget ? 'MEETS' : 'MISSES'} p95<=${TARGET_P95_MS}ms`,
      );
    }
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.scenarios.every((row) => row.meetsTarget) ? 0 : 1;
});
