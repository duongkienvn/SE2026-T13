import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';
import { QueryClient, onlineManager } from '@tanstack/react-query';
import { createHttpClient } from '../src/infrastructure/api/client.ts';
import { ApiError } from '../src/infrastructure/api/errors.ts';
import { createSessionHttpClient } from '../src/infrastructure/api/session-client.ts';
import { createResourceAccess } from '../src/infrastructure/query/resource-access.ts';
import { queryKeys } from '../src/infrastructure/query/keys.ts';
import { activityKeys } from '../src/features/activity/keys.ts';
import {
  createAttachmentApi,
  decodeAttachment,
  decodeIntent,
} from '../src/features/cards/attachments/api.ts';
import {
  FILE_LIMIT,
  httpsUrl,
  displayName,
  fileDeclaration,
  inspectBytes,
  safeFilename,
  attachmentError,
} from '../src/features/cards/attachments/policy.ts';
import {
  attachmentGuard,
  attachmentOptions,
  refreshAttachments,
} from '../src/features/cards/attachments/queries.ts';
import {
  downloadPrivateFile,
  runUpload,
  transferAttachment,
} from '../src/features/cards/attachments/transfer.ts';
import { deferred, FakeTime } from './auth/support.ts';

const {
  Response,
  FormData,
  Blob,
  AbortController,
  TextEncoder,
  TextDecoder,
  setTimeout,
  ReadableStream,
} = globalThis;
const uuid = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const boardId = uuid(1),
  cardId = uuid(2),
  attachmentId = uuid(3),
  operationKey = uuid(4);
const identity = { userId: uuid(5), generation: 1 };
const scope = { identity, boardId, cardId };
const base = `/boards/${boardId}/cards/${cardId}/attachments`;
const text = new TextEncoder().encode('A private note');
const row = (patch = {}) => ({
  id: attachmentId,
  boardId,
  cardId,
  uploaderId: identity.userId,
  kind: 'URL',
  state: 'ACTIVE',
  displayName: 'Research',
  url: 'https://example.test/document',
  originalFilename: null,
  mimeType: null,
  byteSize: null,
  revision: 2,
  createdAt: '2026-11-17T01:00:00.000Z',
  updatedAt: '2026-11-17T01:00:00.000Z',
  ...patch,
});
const fileRow = (patch = {}) =>
  row({
    kind: 'FILE',
    url: null,
    originalFilename: 'note.txt',
    mimeType: 'text/plain',
    byteSize: text.length,
    ...patch,
  });
const dto = (data, status = 200, meta) =>
  Response.json(
    {
      success: true,
      statusCode: status,
      message: 'OK',
      data,
      ...(meta ? { meta } : {}),
    },
    { status },
  );
const failure = (status, code = 'REJECTED') =>
  Response.json(
    { success: false, statusCode: status, code, message: 'Rejected' },
    { status },
  );
function setup(respond) {
  const requests = [];
  const http = createHttpClient({
    baseUrl: new URL('https://example.test/api'),
    fetch: async (url, init) => {
      requests.push({ url: new URL(url), init });
      return respond(new URL(url), init, requests.length);
    },
  });
  return { http, api: createAttachmentApi(http, scope), requests };
}
const signal = () => new AbortController().signal;
const intent = (kind = 'memory', patch = {}) => ({
  uploadId: attachmentId,
  state: 'PENDING',
  expiresAt: new Date(900_000).toISOString(),
  upload: {
    kind,
    url:
      kind === 'memory'
        ? `/api${base}/uploads/${attachmentId}/file`
        : 'https://storage.example.test/bucket',
    fields:
      kind === 'memory'
        ? {}
        : {
            key: 'opaque',
            policy: 'private-grant',
            'x-amz-credential': 'secret',
          },
    expiresAt: new Date(60_000).toISOString(),
  },
  ...patch,
});
function transferPorts(patch = {}) {
  return {
    now: () => 0,
    externalFetch: async () => new Response(null, { status: 204 }),
    multipart: (file, fields) => ({
      kind: 'native-upload',
      createBody() {
        const form = new FormData();
        for (const [key, value] of Object.entries(fields))
          form.append(key, value);
        form.append(
          'file',
          new Blob([text], { type: file.contentType }),
          file.filename,
        );
        return form;
      },
    }),
    ...patch,
  };
}
const selected = () => ({
  uri: 'file:///private/note.txt',
  filename: 'note.txt',
  contentType: 'text/plain',
  fileSize: text.length,
  dispose() {},
});
const job = () => ({
  file: selected(),
  key: operationKey,
  transferAttempted: false,
});

test('URL validation rejects executable schemes, credentials, controls and overlong input', () => {
  for (const value of [
    'javascript:alert(1)',
    'file:///file',
    'http://example.test',
    'https://u:p@example.test',
    'https://@example.test',
    'https://example.test/\nscript',
    'https://example.test/%0a',
    'https://example.test/\\bad',
    'https://' + 'a'.repeat(2050),
  ])
    assert.throws(() => httpsUrl(value));
  assert.equal(httpsUrl('https://example.test'), 'https://example.test/');
  assert.equal(httpsUrl('  https://example.test  '), 'https://example.test/');
  assert.equal(displayName('  Notes  '), 'Notes');
  for (const value of ['', ' ', 'a'.repeat(121), 'evil\nname'])
    assert.throws(() => displayName(value));
});
test('file declarations and actual bytes reject malicious names, mismatch, size and raster limits', () => {
  for (const name of [
    '../../secret.txt',
    'C:\\secret.txt',
    '..',
    '\u202eevil.txt',
    'name\u0000.txt',
    '／secret.txt',
  ])
    assert.throws(() => safeFilename(name));
  assert.equal(safeFilename('hello?.txt'), 'hello_.txt');
  for (const args of [
    ['note.pdf', 'text/plain', 1],
    ['note.txt', 'application/zip', 1],
    ['note.txt', 'text/plain', 0],
    ['note.txt', 'text/plain', FILE_LIMIT + 1],
    ['note.txt', 'text/plain', 1.2],
  ])
    assert.throws(() => fileDeclaration(...args));
  assert.equal(
    fileDeclaration('note.txt', 'text/plain', FILE_LIMIT).fileSize,
    FILE_LIMIT,
  );
  inspectBytes(text, 'text/plain');
  for (const value of [
    '<script>alert(1)</script>',
    '{"success":false,"statusCode":403}',
    '\u0000binary',
  ])
    assert.throws(() =>
      inspectBytes(new TextEncoder().encode(value), 'text/plain'),
    );
  for (const mime of [
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/pdf',
  ])
    assert.throws(() => inspectBytes(text, mime));
  const png = new Uint8Array(33);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  png.set(new TextEncoder().encode('IHDR'), 12);
  const view = new DataView(png.buffer);
  view.setUint32(16, 4000);
  view.setUint32(20, 4000);
  inspectBytes(png, 'image/png');
  view.setUint32(16, 8193);
  assert.throws(() => inspectBytes(png, 'image/png'));
  view.setUint32(16, 4001);
  assert.throws(() => inspectBytes(png, 'image/png'));
});
test('exact URL CRUD routes, status 201/200/204, UUIDv4 and revisions; empty responses never parse JSON', async () => {
  const env = setup(async (_url, init) => {
    if (init.method === 'DELETE') {
      const r = new Response(null, { status: 204 });
      r.text = () => assert.fail('204 parsed');
      return r;
    }
    return dto(row(), init.method === 'POST' ? 201 : 200);
  });
  await env.api.create(
    { url: row().url, displayName: 'Research' },
    operationKey,
  );
  await env.api.get(attachmentId);
  await env.api.edit(row(), {
    url: 'https://example.test/new',
    displayName: 'Changed',
  });
  await env.api.remove(row());
  assert.deepEqual(
    env.requests.map(({ init }) => init.method),
    ['POST', 'GET', 'PATCH', 'DELETE'],
  );
  assert.equal(env.requests[0].init.headers['Idempotency-Key'], operationKey);
  assert.deepEqual(JSON.parse(env.requests[0].init.body), {
    kind: 'URL',
    url: row().url,
    displayName: 'Research',
  });
  assert.deepEqual(JSON.parse(env.requests[2].init.body), {
    expectedRevision: 2,
    url: 'https://example.test/new',
    displayName: 'Changed',
  });
  assert.equal(env.requests[3].url.searchParams.get('expectedRevision'), '2');
  assert.equal(env.requests[0].url.pathname, `/api${base}`);
  assert.throws(() => env.api.create({ url: row().url }, 'bad'));
  assert.throws(() => env.api.edit(fileRow(), { url: row().url }));
  const badStatus = setup(async () => dto(row(), 200));
  await assert.rejects(badStatus.api.create({ url: row().url }, operationKey), {
    kind: 'invalid-response',
  });
});
test('stable logical idempotency survives ambiguous POST; no transport mutation retry', async () => {
  const env = setup(async (_url, _init, n) => {
    if (n === 1) throw new Error('offline after commit');
    return dto(row(), 201);
  });
  await assert.rejects(env.api.create({ url: row().url }, operationKey), {
    kind: 'network',
  });
  assert.equal(env.requests.length, 1);
  await env.api.create({ url: row().url }, operationKey);
  assert.equal(
    env.requests[0].init.headers['Idempotency-Key'],
    env.requests[1].init.headers['Idempotency-Key'],
  );
});
test('intent/complete/cancel propagate owner, access, limits and provider failures without POST retry', async () => {
  for (const status of [401, 403, 404, 409, 413, 415, 422, 429, 503]) {
    for (const operation of ['intent', 'complete', 'cancel']) {
      const env = setup(async () =>
        failure(
          status,
          status === 409 ? 'ATTACHMENT_REVISION_CONFLICT' : 'REJECTED',
        ),
      );
      const pending =
        operation === 'intent'
          ? env.api.intent(selected(), operationKey)
          : env.api[operation](attachmentId);
      await assert.rejects(pending, { kind: 'http', status });
      assert.equal(env.requests.length, 1);
    }
  }
});
test('ACTIVE metadata decoding rejects pending, removed, cross-card and invalid file metadata', () => {
  for (const patch of [
    { state: 'PENDING' },
    { state: 'REMOVED' },
    { cardId: uuid(99) },
    { boardId: uuid(99) },
    { revision: 0 },
    { url: 'http://example.test' },
    { uploaderId: 'bad' },
  ])
    assert.throws(() => decodeAttachment(row(patch), boardId, cardId));
  assert.throws(() =>
    decodeAttachment(fileRow({ byteSize: FILE_LIMIT + 1 }), boardId, cardId),
  );
  assert.throws(() =>
    decodeAttachment(
      fileRow({ originalFilename: '../note.txt' }),
      boardId,
      cardId,
    ),
  );
  assert.equal(decodeAttachment(fileRow(), boardId, cardId).kind, 'FILE');
  assert.throws(() =>
    decodeIntent(
      intent('s3', {
        upload: { ...intent('s3').upload, fields: { file: 'bad' } },
      }),
    ),
  );
});
for (const total of [0, 1, 20, 100, 101])
  test(`pagination ${total} uses exact metadata and explicitly loads page 2`, async () => {
    const env = setup(async (url) => {
      const page = Number(url.searchParams.get('page'));
      const size = Math.min(100, Math.max(0, total - (page - 1) * 100));
      return dto(
        Array.from({ length: size }, (_, i) =>
          row({ id: uuid(100 + i + (page - 1) * 100) }),
        ),
        200,
        { page, limit: 100, total, totalPages: Math.ceil(total / 100) },
      );
    });
    const page = await env.api.list(1);
    assert.equal(page.data.length, Math.min(total, 100));
    assert.equal(env.requests.length, 1);
    if (total === 101) assert.equal((await env.api.list(2)).data.length, 1);
    assert.equal(env.requests[0].url.searchParams.get('limit'), '100');
    await assert.rejects(env.api.list(0));
  });
test('memory transfer sends authenticated exact multipart, intent body, complete and cancellation', async () => {
  const requests = [];
  const http = createHttpClient({
    baseUrl: new URL('https://example.test/api'),
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/complete')) return dto(fileRow());
      if (url.endsWith('/uploads') && init.method === 'POST')
        return dto(intent(), 201);
      if (init.method === 'POST') {
        assert.equal(init.headers.Authorization, 'Bearer private-test');
        assert.equal(init.headers['Content-Type'], undefined);
        assert.deepEqual([...init.body.keys()], ['file']);
        assert.equal(
          await init.body.get('file').text(),
          new TextDecoder().decode(text),
        );
      }
      return new Response(null, { status: 204 });
    },
  });
  const api = createAttachmentApi(
    {
      ...http,
      empty: (path, options) =>
        http.empty(path, { ...options, accessToken: 'private-test' }),
    },
    scope,
  );
  const phases = [];
  assert.equal(
    (
      await runUpload(
        api,
        boardId,
        cardId,
        job(),
        transferPorts(),
        signal(),
        () => {},
        (phase) => phases.push(phase),
      )
    ).state,
    'ACTIVE',
  );
  assert.deepEqual(phases, ['intent', 'uploading', 'verifying']);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    filename: 'note.txt',
    contentType: 'text/plain',
    fileSize: text.length,
  });
  assert.equal(requests[0].init.headers['Idempotency-Key'], operationKey);
  assert.deepEqual(JSON.parse(requests[2].init.body), {});
  await api.cancel(attachmentId);
  assert.equal(requests[3].init.method, 'DELETE');
});
test('S3 exact opaque fields and file last, without Authorization, cookies or manual boundary', async () => {
  let sent;
  const ports = transferPorts({
    externalFetch: async (url, init) => {
      sent = { url, init };
      return new Response(null, { status: 204 });
    },
  });
  await transferAttachment(
    {},
    boardId,
    cardId,
    intent('s3'),
    selected(),
    ports,
    signal(),
    () => {},
  );
  assert.equal(sent.url, intent('s3').upload.url);
  assert.equal(sent.init.method, 'POST');
  assert.equal(sent.init.credentials, 'omit');
  assert.equal(sent.init.redirect, 'error');
  assert.equal(sent.init.headers, undefined);
  assert.deepEqual(
    [...sent.init.body.keys()],
    [...Object.keys(intent('s3').upload.fields), 'file'],
  );
  for (const [key, value] of Object.entries(intent('s3').upload.fields))
    assert.equal(sent.init.body.get(key), value);
});
test('expired or malformed grants never transfer; ACTIVE replay does not upload', async () => {
  const ports = transferPorts({
    externalFetch: () => assert.fail('Sent invalid grant'),
  });
  for (const target of [
    intent('s3', { expiresAt: new Date(0).toISOString() }),
    intent('s3', {
      upload: { ...intent('s3').upload, expiresAt: new Date(0).toISOString() },
    }),
    intent('s3', {
      upload: { ...intent('s3').upload, url: 'http://storage.test' },
    }),
    intent('s3', {
      upload: { ...intent('s3').upload, url: 'https://u:p@storage.test' },
    }),
    intent('memory', {
      upload: { ...intent().upload, url: 'https://evil.test/api' },
    }),
  ])
    await assert.rejects(
      transferAttachment(
        {},
        boardId,
        cardId,
        target,
        selected(),
        ports,
        signal(),
        () => {},
      ),
    );
  let uploads = 0;
  const active = await runUpload(
    {
      intent: async () => ({ ...intent(), state: 'ACTIVE', upload: null }),
      get: async () => fileRow(),
      memory: () => uploads++,
    },
    boardId,
    cardId,
    job(),
    ports,
    signal(),
    () => {},
    () => {},
  );
  assert.equal(active.state, 'ACTIVE');
  assert.equal(uploads, 0);
});
test('uncertain transfer retries complete before deciding whether bytes need transfer; key remains stable', async () => {
  const logical = job();
  let attempts = 0,
    completions = 0,
    reservations = 0;
  const api = {
    intent: async (_input, key) => {
      assert.equal(key, operationKey);
      reservations++;
      return intent();
    },
    memory: async () => {
      attempts++;
      throw new ApiError('network');
    },
    complete: async () => {
      completions++;
      return fileRow();
    },
  };
  await assert.rejects(
    runUpload(
      api,
      boardId,
      cardId,
      logical,
      transferPorts(),
      signal(),
      () => {},
      () => {},
    ),
  );
  assert.equal(attempts, 1);
  assert.equal(
    (
      await runUpload(
        api,
        boardId,
        cardId,
        logical,
        transferPorts(),
        signal(),
        () => {},
        () => {},
      )
    ).state,
    'ACTIVE',
  );
  assert.equal(attempts, 1);
  assert.equal(reservations, 1);
  assert.equal(completions, 1);
  api.complete = async () => {
    throw new ApiError('http', {
      status: 409,
      code: 'ATTACHMENT_NOT_UPLOADED',
    });
  };
  api.memory = async () => {
    attempts++;
  };
  await assert.rejects(
    runUpload(
      api,
      boardId,
      cardId,
      logical,
      transferPorts(),
      signal(),
      () => {},
      () => {},
    ),
  );
  assert.equal(attempts, 2);
  assert.equal(reservations, 2);
});
test('abort races acknowledged intent and S3 fetch ignoring signal without late success', async () => {
  const controller = new AbortController();
  let canceled = false;
  const api = {
    intent: async () => {
      controller.abort();
      return intent();
    },
    cancel: async () => {
      canceled = true;
    },
  };
  const check = () => {
    if (controller.signal.aborted) throw new ApiError('aborted');
  };
  await assert.rejects(
    runUpload(
      api,
      boardId,
      cardId,
      job(),
      transferPorts(),
      controller.signal,
      check,
      () => {},
    ),
    { kind: 'aborted' },
  );
  assert.equal(canceled, true);
  const blocked = deferred();
  const second = new AbortController();
  const promise = transferAttachment(
    {},
    boardId,
    cardId,
    intent('s3'),
    selected(),
    transferPorts({ externalFetch: () => blocked.promise }),
    second.signal,
    () => {},
  );
  second.abort();
  await assert.rejects(promise, { kind: 'aborted' });
  blocked.resolve(new Response(null, { status: 204 }));
});
test('bounded raw binary validates content length and rejects HTTP/JSON/MIME/truncation/overrun before save', async () => {
  const good = () =>
    new Response(text, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': String(text.length),
        'content-disposition': 'attachment; filename="../../evil.exe"',
      },
    });
  const env = setup(async () => good());
  let saved = 0,
    cleaned = 0,
    shared = 0;
  const save = (bytes, value) => {
    saved++;
    assert.deepEqual(bytes, text);
    assert.equal(value.originalFilename, 'note.txt');
    return { uri: 'file:///private/note.txt', dispose: () => cleaned++ };
  };
  await downloadPrivateFile(
    env.api,
    fileRow(),
    signal(),
    () => {},
    save,
    async () => {
      shared++;
    },
  );
  assert.equal(saved, 1);
  assert.equal(shared, 1);
  assert.equal(cleaned, 1);
  const invalid = [
    () => failure(401),
    () => failure(403),
    () => failure(404),
    () => Response.json({ success: false }),
    () =>
      new Response(text, {
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(text.length),
        },
      }),
    () => new Response(text, { headers: { 'content-type': 'text/plain' } }),
    () =>
      new Response(text, {
        headers: { 'content-type': 'text/plain', 'content-length': '0' },
      }),
    () =>
      new Response(text, {
        headers: {
          'content-type': 'text/plain',
          'content-length': String(FILE_LIMIT + 1),
        },
      }),
    () =>
      new Response(text, {
        headers: {
          'content-type': 'text/plain',
          'content-length': String(text.length + 1),
        },
      }),
    () =>
      new Response(text, {
        headers: { 'content-type': 'text/plain', 'content-length': '1' },
      }),
    () =>
      new Response('{"success":false,"statusCode":403}', {
        headers: { 'content-type': 'text/plain', 'content-length': '34' },
      }),
  ];
  for (const response of invalid)
    await assert.rejects(
      downloadPrivateFile(
        setup(async () => response()).api,
        fileRow(),
        signal(),
        () => {},
        () => assert.fail('Saved invalid response'),
        () => assert.fail('Shared invalid response'),
      ),
    );
});
test('stream reader stops on cancel and byte ceiling; sharing errors and revoke delete temporary bytes', async () => {
  let canceled = false;
  const stalled = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      canceled = true;
    },
  });
  const env = setup(
    async () =>
      new Response(stalled, {
        headers: {
          'content-type': 'text/plain',
          'content-length': String(text.length),
        },
      }),
  );
  const controller = new AbortController();
  const promise = env.api.download(fileRow(), controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(promise, { kind: 'aborted' });
  assert.equal(canceled, true);
  let removed = 0;
  const shared = deferred();
  const revoke = new AbortController();
  const rawApi = {
    download: async () => ({
      bytes: text.buffer,
      contentType: 'text/plain',
      contentLength: text.length,
    }),
  };
  const sharing = downloadPrivateFile(
    rawApi,
    fileRow(),
    revoke.signal,
    () => {
      if (revoke.signal.aborted) throw new ApiError('aborted');
    },
    () => ({ uri: 'file:///private/note.txt', dispose: () => removed++ }),
    () => shared.promise,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  revoke.abort();
  assert.equal(removed, 1);
  shared.resolve();
  await assert.rejects(sharing, { kind: 'aborted' });
  assert.equal(removed, 2);
  await assert.rejects(
    downloadPrivateFile(
      rawApi,
      fileRow(),
      signal(),
      () => {},
      () => ({ uri: 'private', dispose: () => removed++ }),
      async () => {
        throw new Error('OS unavailable');
      },
    ),
  );
  assert.equal(removed, 3);
});
test('deadline and binary error responses do not expose an artifact', async () => {
  const time = new FakeTime();
  const http = createHttpClient({
    baseUrl: new URL('https://example.test/api'),
    timers: time,
    clock: time,
    fetch: () => new Promise(() => {}),
  });
  const promise = createAttachmentApi(http, scope).download(
    fileRow(),
    signal(),
  );
  time.advance(120_000);
  await assert.rejects(promise, { kind: 'timeout' });
});
test('write guard requires verified board capability and active card; read-only download guard remains readable', async () => {
  const queryClient = new QueryClient();
  const resources = createResourceAccess();
  let current = true;
  const data = {
    queryClient,
    resources,
    assertCurrent: () => {
      if (!current) throw new ApiError('session-changed');
    },
  };
  const boardKey = queryKeys.board(identity, boardId),
    cardKey = queryKeys.card(identity, boardId, cardId);
  queryClient.setQueryData(boardKey, {
    capabilities: { canWriteBoard: true },
    isArchived: false,
  });
  queryClient.setQueryData(cardKey, { isArchived: false });
  resources.confirmBoard(boardId, true);
  attachmentGuard(data, scope, true, () => true, signal())();
  for (const patch of [
    { capabilities: { canWriteBoard: false } },
    { isArchived: true },
  ]) {
    queryClient.setQueryData(boardKey, {
      capabilities: { canWriteBoard: true },
      isArchived: false,
      ...patch,
    });
    assert.throws(
      attachmentGuard(data, scope, true, () => true, signal()),
      { status: 403 },
    );
    attachmentGuard(data, scope, false, () => true, signal())();
  }
  current = false;
  assert.throws(
    attachmentGuard(data, scope, false, () => true, signal()),
    { kind: 'session-changed' },
  );
  current = true;
  const read = attachmentGuard(data, scope, false, () => true, signal());
  resources.fenceBoard(boardId, true);
  assert.throws(read, { code: 'RESOURCE_ACCESS_CHANGED' });
  resources.confirmBoard(boardId, true);
  onlineManager.setOnline(false);
  assert.throws(
    attachmentGuard(data, scope, false, () => true, signal()),
    { kind: 'offline' },
  );
  onlineManager.setOnline(true);
  queryClient.clear();
});
test('attachment invalidations target child and previews without mutating card/checklist drafts', async () => {
  const queryClient = new QueryClient();
  const resources = createResourceAccess();
  let targets;
  const data = {
    api: {},
    queryClient,
    resources,
    assertCurrent() {},
    invalidate: async (_identity, keys) => {
      targets = keys;
    },
  };
  const checklist = queryKeys.checklists(identity, boardId, cardId),
    card = queryKeys.card(identity, boardId, cardId);
  queryClient.setQueryData(checklist, { pending: 'checkbox draft' });
  queryClient.setQueryData(card, { title: 'dirty title' });
  await refreshAttachments(data, scope);
  assert.deepEqual(
    targets[0],
    queryKeys.attachments(identity, boardId, cardId),
  );
  assert.equal(targets.length, 4);
  assert.deepEqual(targets[3], activityKeys.board(identity, boardId));
  assert.deepEqual(queryClient.getQueryData(checklist), {
    pending: 'checkbox draft',
  });
  assert.deepEqual(queryClient.getQueryData(card), { title: 'dirty title' });
  const options = attachmentOptions(data, scope);
  assert.equal(
    options.getNextPageParam({ meta: { page: 1, totalPages: 2 } }),
    2,
  );
  queryClient.clear();
});
test('bound transport fences account switch, aborts revoke and applies matching 401', async () => {
  const listeners = new Set();
  let generation = 1,
    unauthorized = 0;
  const manager = {
    getAccessCredential: () => ({ accessToken: 'private', generation }),
    getSnapshot: () => ({
      status: 'authenticated',
      generation,
      user: { id: identity.userId },
    }),
    addLifecycleListener: (value) => {
      listeners.add(value);
      return () => listeners.delete(value);
    },
    handleUnauthorized: () => unauthorized++,
  };
  const response = deferred();
  const resources = createResourceAccess();
  const env = setup(() => response.promise);
  const bound = createSessionHttpClient(env.http, manager, resources);
  const api = createAttachmentApi(bound.client, scope);
  const pending = api.download(fileRow(), signal());
  generation++;
  for (const listener of listeners) listener.onSessionEnd?.();
  response.resolve(
    new Response(text, {
      headers: {
        'content-type': 'text/plain',
        'content-length': String(text.length),
      },
    }),
  );
  await assert.rejects(pending, { kind: 'session-changed' });
  bound.dispose();
  generation = 1;
  const denied = createSessionHttpClient(
    setup(async () => failure(401)).http,
    manager,
    resources,
  );
  await assert.rejects(
    createAttachmentApi(denied.client, scope).download(fileRow(), signal()),
    { status: 401 },
  );
  assert.equal(unauthorized, 1);
  denied.dispose();
});
test('meaningful bounded file errors cover quotas, type, expiry and provider unavailable', () => {
  for (const [status, code, phrase] of [
    [409, 'ATTACHMENT_LIMIT_REACHED', '20 per card'],
    [409, 'ATTACHMENT_REVISION_CONFLICT', 'changed'],
    [409, 'ATTACHMENT_UPLOAD_EXPIRED', 'expired'],
    [413, 'X', '10 MiB'],
    [415, 'X', 'type or content'],
    [422, 'X', 'type or content'],
    [429, 'X', 'Wait'],
    [503, 'X', 'unavailable'],
  ])
    assert.match(
      attachmentError(new ApiError('http', { status, code })),
      new RegExp(phrase),
    );
});
