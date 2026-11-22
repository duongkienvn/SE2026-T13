import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DATA_EXPORT_BYTE_LIMIT,
  downloadExport,
  exportError,
  exportFilename,
  fallbackFilename,
  validTarget,
  type ExportTarget,
} from '../../src/features/exports/model.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { integration, json } from '../realtime/integration-support.ts';
import { USER_B, flush, loginResponse } from '../auth/support.ts';
import {
  destinationPath,
  parseLink,
  parsePath,
} from '../../src/navigation/routes.ts';

const BOARD = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NOW = new Date('2026-11-22T10:00:00Z');
const account: ExportTarget = { kind: 'account' };
const csv: ExportTarget = { kind: 'board', boardId: BOARD, format: 'csv' };
const boardJson: ExportTarget = {
  kind: 'board',
  boardId: BOARD,
  format: 'json',
};
const signal = () => new AbortController().signal;
type Handler = (url: string, init: RequestInit) => Promise<Response> | null;
const at =
  (path: string, make: (init: RequestInit) => Response): Handler =>
  (url, init) =>
    new URL(url).pathname.endsWith(path) ? Promise.resolve(make(init)) : null;

function stream(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}
function file(
  body: Uint8Array | ReadableStream<Uint8Array>,
  {
    type = 'application/json; charset=utf-8',
    name = 'kanvexa-account-2026-11-22.json',
    length,
    status = 200,
  }: {
    type?: string;
    name?: string | null;
    length?: number | null;
    status?: number;
  } = {},
) {
  const headers: Record<string, string> = { 'content-type': type };
  if (name !== null)
    headers['content-disposition'] = `attachment; filename="${name}"`;
  const size = body instanceof Uint8Array ? body.byteLength : undefined;
  const declared = length === undefined ? size : length;
  if (declared !== null && declared !== undefined)
    headers['content-length'] = String(declared);
  return new Response(body as BodyInit, { status, headers });
}
const accountBytes = new TextEncoder().encode(
  JSON.stringify({ schemaVersion: 1, account: { id: 'x' } }),
);

test('filename: exact documented shape only; everything else falls back safely', () => {
  assert.equal(
    exportFilename(
      account,
      'attachment; filename="kanvexa-account-2026-11-21.json"',
      NOW,
    ),
    'kanvexa-account-2026-11-21.json',
  );
  assert.equal(
    exportFilename(
      csv,
      `attachment; filename="kanvexa-board-${BOARD}-2026-11-21.csv"`,
      NOW,
    ),
    `kanvexa-board-${BOARD}-2026-11-21.csv`,
  );
  const fallback = `kanvexa-board-${BOARD}-2026-11-22.csv`;
  for (const header of [
    null,
    'attachment; filename="../../etc/passwd"',
    'attachment; filename="/data/kanvexa-account-2026-11-21.json"',
    `attachment; filename="kanvexa-board-${BOARD}-2026-11-21.json"`, // wrong ext
    `attachment; filename="kanvexa-board-${BOARD}-2026-11-21.csv.exe"`,
    `attachment; filename="kanvexa-board-${BOARD.replace('a', 'b')}-2026-11-21.csv"`,
    `attachment; filename="kanvexa-board-${BOARD}-2026-11-21.csv"\r\nSet-Cookie: x`,
    `attachment; filename="kanvexa-board-${BOARD}‮-2026-11-21.csv"`,
    `inline; filename="kanvexa-board-${BOARD}-2026-11-21.csv"`,
    `attachment; filename=kanvexa-board-${BOARD}-2026-11-21.csv`,
    `attachment; filename="${'a'.repeat(300)}.csv"`,
    'attachment; filename="Secret Board – alice@example.com.csv"',
  ])
    assert.equal(exportFilename(csv, header, NOW), fallback, String(header));
  assert.equal(
    fallbackFilename(account, NOW),
    'kanvexa-account-2026-11-22.json',
  );
});

test('targets: only lowercase UUID Boards and json/csv formats', () => {
  assert.ok(validTarget(account));
  assert.ok(validTarget(csv));
  for (const target of [
    { kind: 'board', boardId: BOARD.toUpperCase(), format: 'json' },
    { kind: 'board', boardId: '../users/me', format: 'json' },
    { kind: 'board', boardId: BOARD, format: 'xlsx' },
  ] as ExportTarget[])
    assert.equal(validTarget(target), false);
});

test('account export: exact raw 200 bytes, format query, bearer header only, no redirects/caching', async () => {
  const env = await integration();
  try {
    let seen: { url: string; init: RequestInit } | null = null;
    env.respond((url, init) => {
      if (!new URL(url).pathname.endsWith('/users/me/export')) return null;
      seen = { url, init };
      return Promise.resolve(file(accountBytes));
    });
    const result = await downloadExport(
      env.data.api,
      env.identity,
      account,
      signal(),
    );
    assert.deepEqual(result.bytes, accountBytes);
    assert.equal(result.mimeType, 'application/json');
    assert.equal(result.filename, 'kanvexa-account-2026-11-22.json');
    const url = new URL(seen!.url);
    assert.equal(url.searchParams.get('format'), 'json');
    assert.ok(!/bearer|token|ey[A-Za-z0-9]/i.test(url.search));
    assert.equal(seen!.init.redirect, 'error');
    assert.equal(seen!.init.cache, 'no-store');
    assert.equal(seen!.init.credentials, 'omit');
    assert.match(
      String(new Headers(seen!.init.headers).get('authorization')),
      /^Bearer /,
    );
  } finally {
    env.dispose();
  }
});

test('board CSV keeps BOM, CRLF and order byte-for-byte, even without Content-Length and across chunks', async () => {
  const env = await integration();
  try {
    const text = '﻿boardId,title\r\n1,"=SUM(A1)"\r\n2,Ünïcødé\r\n';
    const bytes = new TextEncoder().encode(text);
    const parts = [bytes.slice(0, 1), bytes.slice(1, 7), bytes.slice(7)];
    env.respond(
      at(`/boards/${BOARD}/export`, () =>
        file(stream(parts), {
          type: 'text/csv; charset=utf-8',
          name: `kanvexa-board-${BOARD}-2026-11-22.csv`,
          length: null,
        }),
      ),
    );
    const progress: [number, number | undefined][] = [];
    const result = await downloadExport(
      env.data.api,
      env.identity,
      csv,
      signal(),
      (received, total) => progress.push([received, total]),
    );
    assert.deepEqual(result.bytes, bytes);
    assert.equal(result.mimeType, 'text/csv');
    assert.deepEqual(
      progress.map(([received]) => received),
      [1, 7, bytes.length],
    );
    assert.ok(progress.every(([, total]) => total === undefined));
  } finally {
    env.dispose();
  }
});

test('20 MiB exactly passes; +1 byte fails as too large with or without a declared length', async () => {
  const env = await integration();
  try {
    const exact = new Uint8Array(DATA_EXPORT_BYTE_LIMIT).fill(0x20);
    exact[0] = 0x7b; // '{'
    exact[DATA_EXPORT_BYTE_LIMIT - 1] = 0x7d; // '}'
    env.respond(at('/users/me/export', () => file(exact)));
    const ok = await downloadExport(
      env.data.api,
      env.identity,
      account,
      signal(),
    );
    assert.equal(ok.bytes.byteLength, DATA_EXPORT_BYTE_LIMIT);
    const over = new Uint8Array(DATA_EXPORT_BYTE_LIMIT + 1).fill(0x20);
    for (const length of [undefined, null, 10]) {
      env.respond(
        at('/users/me/export', () =>
          file(
            length === undefined
              ? over
              : stream([over.slice(0, 1024), over.slice(1024)]),
            {
              length,
            },
          ),
        ),
      );
      await assert.rejects(
        () => downloadExport(env.data.api, env.identity, account, signal()),
        (error) =>
          error instanceof ApiError &&
          (length === 10
            ? error.kind === 'invalid-response'
            : error.code === 'RESPONSE_TOO_LARGE'),
        String(length),
      );
    }
  } finally {
    env.dispose();
  }
});

test('204, HTML, wrong MIME, JSON envelope, missing attachment disposition are never exports', async () => {
  const env = await integration();
  try {
    const cases = [
      () => new Response(null, { status: 204 }),
      () =>
        file(new TextEncoder().encode('<html>login</html>'), {
          type: 'text/html',
        }),
      () => file(accountBytes, { type: 'text/csv' }),
      () =>
        file(
          new TextEncoder().encode(
            JSON.stringify({ success: true, statusCode: 200, data: {} }),
          ),
        ),
      () => file(accountBytes, { name: null }),
      () => file(new Uint8Array()),
    ];
    for (const make of cases) {
      env.respond(at('/users/me/export', make));
      await assert.rejects(
        () => downloadExport(env.data.api, env.identity, account, signal()),
        (error) =>
          error instanceof ApiError && error.kind === 'invalid-response',
      );
    }
    assert.equal(env.manager.getSnapshot().status, 'authenticated');
  } finally {
    env.dispose();
  }
});

test('structured errors: 413/403/404/429 parsed safely; 401 ends the session', async () => {
  const env = await integration();
  try {
    const fail = (
      status: number,
      code: string,
      headers: Record<string, string> = {},
    ) => {
      const response = json(
        {
          success: false,
          statusCode: status,
          code,
          message: 'SECRET board name',
        },
        status,
      );
      for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
      return response;
    };
    for (const [status, code] of [
      [413, 'EXPORT_TOO_LARGE'],
      [403, 'FORBIDDEN'],
      [404, 'NOT_FOUND'],
    ] as const) {
      env.respond(at(`/boards/${BOARD}/export`, () => fail(status, code)));
      await assert.rejects(
        () => downloadExport(env.data.api, env.identity, boardJson, signal()),
        (error) =>
          error instanceof ApiError &&
          error.status === status &&
          error.code === code,
      );
    }
    env.respond(
      at('/users/me/export', () =>
        fail(429, 'TOO_MANY_REQUESTS', { 'retry-after': '30' }),
      ),
    );
    await assert.rejects(
      () => downloadExport(env.data.api, env.identity, account, signal()),
      (error) => error instanceof ApiError && error.retryAfterMs === 30_000,
    );
    env.respond(at('/users/me/export', () => fail(401, 'UNAUTHORIZED')));
    await assert.rejects(() =>
      downloadExport(env.data.api, env.identity, account, signal()),
    );
    await flush();
    assert.equal(env.manager.getSnapshot().status, 'unauthenticated');
  } finally {
    env.dispose();
  }
});

test('abort mid-stream and User A→B switch discard the download', async () => {
  const env = await integration();
  try {
    let push!: (chunk: Uint8Array) => void;
    let end!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (chunk) => controller.enqueue(chunk);
        end = () => controller.close();
      },
    });
    env.respond(at('/users/me/export', () => file(body, { length: 4 })));
    const controller = new AbortController();
    const pending = downloadExport(
      env.data.api,
      env.identity,
      account,
      controller.signal,
    ).then(
      () => 'ok',
      (error: ApiError) => error.kind,
    );
    await flush();
    push(new Uint8Array([0x7b, 0x7d]));
    controller.abort();
    assert.equal(await pending, 'aborted');

    let finish!: (response: Response) => void;
    env.respond((url) =>
      new URL(url).pathname.endsWith('/users/me/export')
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : null,
    );
    const late = downloadExport(
      env.data.api,
      env.identity,
      account,
      signal(),
    ).then(
      () => 'ok',
      (error: ApiError) => error.kind,
    );
    await flush();
    await env.manager.establishSession(loginResponse(USER_B));
    finish(file(accountBytes));
    assert.notEqual(await late, 'ok');
    void end;
  } finally {
    env.dispose();
  }
});

test('error copy is specific, never echoes server text, never claims a saved file', () => {
  const http = (status: number, code?: string) =>
    new ApiError('http', { status, code, message: 'SECRET board name' });
  const messages = [
    exportError(http(413, 'EXPORT_TOO_LARGE'), csv),
    exportError(
      new ApiError('invalid-response', { code: 'RESPONSE_TOO_LARGE' }),
      account,
    ),
    exportError(http(403), csv),
    exportError(http(429), account),
    exportError(new ApiError('offline'), account),
    exportError(new ApiError('timeout'), account),
    exportError(new ApiError('network'), account),
    exportError(new ApiError('invalid-response'), account),
    exportError(
      new ApiError('http', { code: 'PRIVATE_STORAGE_FAILED' }),
      account,
    ),
    exportError(
      new ApiError('http', { code: 'PRIVATE_STORAGE_UNAVAILABLE' }),
      account,
    ),
  ];
  assert.equal(new Set(messages).size, messages.length);
  assert.match(messages[0]!, /10,000 cards/);
  for (const message of messages) {
    assert.ok(!message.includes('SECRET'));
    assert.ok(!/saved to|downloaded to/i.test(message));
  }
});

test('data-privacy is one exact private screen', () => {
  assert.deepEqual(parsePath('/data-privacy'), {
    kind: 'screen',
    screen: 'data-privacy',
  });
  assert.equal(
    destinationPath({ kind: 'screen', screen: 'data-privacy' }),
    '/data-privacy',
  );
  assert.equal(parsePath('/data-privacy/export'), null);
  assert.equal(parseLink('https://kanvexa.tech/data-privacy?userId=x'), null);
});
