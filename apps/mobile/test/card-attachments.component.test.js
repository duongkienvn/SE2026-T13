/* global jest, test, expect, afterEach */
import React from 'react';
import { URL } from 'node:url';
import { AppState, Dimensions, Linking, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { createSessionManager } from '../src/infrastructure/auth/session-manager';
import { createCredentialStore } from '../src/infrastructure/auth/credential-store';
import { createHttpClient } from '../src/infrastructure/api/client';
import { createMobileDataLayer } from '../src/infrastructure/query/data-layer';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { queryKeys } from '../src/infrastructure/query/keys';
import { CardAttachmentsSection } from '../src/features/cards/detail/sections';
import {
  selectPrivateFile,
  nativeTransferPorts,
  clearPrivateAttachmentFiles,
  savePrivateDownload,
  previewPrivateFile,
  sharePrivateFile,
} from '../src/features/cards/attachments/native';
import { palettes, ThemeContext } from '../src/ui';
import {
  FakeSessionApi,
  FakeTime,
  MemorySecureStore,
  USER_A,
  USER_B,
  deferred,
  loginResponse,
  user,
} from './auth/support';
import {
  boardDetail,
  boardId,
  cardDto,
  timestamp,
} from './workspaces/kanban-fixtures';
import { uuid } from './workspaces/fixtures';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
jest.mock('../src/features/cards/attachments/native', () => ({
  clearPrivateAttachmentFiles: jest.fn(),
  selectPrivateFile: jest.fn(async () => null),
  savePrivateDownload: jest.fn(),
  sharePrivateFile: jest.fn(),
  previewPrivateFile: jest.fn(async () => {}),
  newAttachmentKey: jest.fn(() => '11111111-1111-4111-8111-111111111111'),
  nativeTransferPorts: {
    now: Date.now,
    multipart: jest.fn(() => ({
      kind: 'native-upload',
      createBody: () => new globalThis.FormData(),
    })),
    externalFetch: jest.fn(),
  },
}));
const cardId = cardDto(1).id;
const attachmentId = uuid(9001);
const base = `/api/boards/${boardId}/cards/${cardId}/attachments`;
const attachment = (patch = {}) => ({
  id: attachmentId,
  boardId,
  cardId,
  uploaderId: USER_A,
  kind: 'URL',
  state: 'ACTIVE',
  displayName: 'Design prototype',
  url: 'https://example.test/prototype',
  originalFilename: null,
  mimeType: null,
  byteSize: null,
  revision: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  ...patch,
});
const response = (data, status = 200, meta) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {
    get: (key) => (key === 'content-type' ? 'application/json' : null),
  },
  text: async () =>
    JSON.stringify({
      success: true,
      statusCode: status,
      message: 'OK',
      data,
      ...(meta ? { meta } : {}),
    }),
});
const failure = (status, code) => ({
  ...response(null, status),
  text: async () =>
    JSON.stringify({
      success: false,
      statusCode: status,
      code,
      message: 'Attachment changed; reload before retrying',
    }),
});
const mounted = [];
afterEach(async () => {
  for (const env of mounted.splice(0)) {
    await env.view.unmount();
    env.data.dispose();
    env.manager.dispose();
  }
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
  selectPrivateFile.mockReset();
  selectPrivateFile.mockResolvedValue(null);
  nativeTransferPorts.externalFetch.mockReset();
  clearPrivateAttachmentFiles.mockClear();
  savePrivateDownload.mockReset();
  previewPrivateFile.mockClear();
  sharePrivateFile.mockClear();
});
async function setup({
  rows = [],
  override,
  readOnly = false,
  archived = false,
  mode = 'light',
} = {}) {
  onlineManager.setOnline(true);
  const time = new FakeTime();
  const auth = new FakeSessionApi();
  auth.auto = (token) => ({
    kind: 'verified',
    user: user(token === loginResponse(USER_B).accessToken ? USER_B : USER_A),
  });
  const manager = createSessionManager({
    api: auth,
    store: createCredentialStore(new MemorySecureStore()),
    clock: time,
    timers: time,
  });
  await manager.establishSession(loginResponse(USER_A));
  let currentRows = rows;
  const requests = [];
  const data = createMobileDataLayer(
    manager,
    createHttpClient({
      baseUrl: new URL('https://example.test/api'),
      clock: time,
      timers: time,
      isOnline: () => onlineManager.isOnline(),
      fetch: async (input, init) => {
        const url = new URL(input);
        const request = {
          path: url.pathname,
          page: Number(url.searchParams.get('page')) || 1,
          method: init.method,
          body:
            typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
          headers: init.headers,
          signal: init.signal,
        };
        requests.push(request);
        const custom = override?.(request);
        if (custom) return custom;
        if (url.pathname === base && init.method === 'GET')
          return response(currentRows, 200, {
            page: 1,
            limit: 100,
            total: currentRows.length,
            totalPages: currentRows.length ? 1 : 0,
          });
        if (url.pathname === base && init.method === 'POST') {
          const row = attachment({
            url: request.body.url,
            displayName: request.body.displayName ?? 'example.test',
          });
          currentRows = [row];
          return response(row, 201);
        }
        if (url.pathname === `${base}/${attachmentId}` && init.method === 'GET')
          return response(currentRows[0]);
        if (
          url.pathname === `${base}/${attachmentId}` &&
          init.method === 'PATCH'
        ) {
          currentRows = [attachment({ ...request.body, revision: 2 })];
          return response(currentRows[0]);
        }
        if (init.method === 'DELETE') {
          currentRows = [];
          return response(null, 204);
        }
        return failure(404, 'NOT_FOUND');
      },
    }),
    time,
  );
  // Access-loss tests detach observers after removing their queries. Keep the
  // production GC delay out of this explicitly disposed component fixture.
  data.queryClient.setDefaultOptions({
    ...data.queryClient.getDefaultOptions(),
    queries: {
      ...data.queryClient.getDefaultOptions().queries,
      gcTime: Infinity,
    },
  });
  const identity = data.getIdentity();
  const board = {
    ...boardDetail,
    isArchived: archived,
    capabilities: { ...boardDetail.capabilities, canWriteBoard: !readOnly },
  };
  const card = { ...cardDto(1), isArchived: archived };
  data.resources.confirmBoard(boardId, !readOnly && !archived);
  data.queryClient.setQueryData(queryKeys.board(identity, boardId), board);
  data.queryClient.setQueryData(
    queryKeys.card(identity, boardId, cardId),
    card,
  );
  const context = {
    identity,
    boardId,
    cardId,
    board,
    card,
    canEdit: !readOnly && !archived,
    readOnly: readOnly || archived,
    active: true,
    refreshCard: async () => {},
  };
  const tree = (next = context) => (
    <SessionProvider manager={manager}>
      <DataProvider layer={data}>
        <ThemeContext.Provider value={mode}>
          <CardAttachmentsSection context={next} />
        </ThemeContext.Provider>
      </DataProvider>
    </SessionProvider>
  );
  const view = await render(tree());
  const env = {
    view,
    data,
    manager,
    requests,
    context,
    rerender: (next) => view.rerender(tree(next)),
  };
  mounted.push(env);
  return env;
}
const press = async (label) =>
  fireEvent.press(await screen.findByRole('button', { name: label }));

test('101-row pagination detects concurrent totals and reloads instead of showing a false count', async () => {
  let reads = 0;
  const env = await setup({
    override: ({ path, page, method }) => {
      if (path !== base || method !== 'GET') return null;
      const total = reads++ === 0 ? 101 : 102;
      const count = page === 1 ? 100 : 2;
      return response(
        Array.from({ length: count }, (_, i) =>
          attachment({
            id: uuid(20000 + (page - 1) * 100 + i),
            displayName: `Link ${(page - 1) * 100 + i}`,
          }),
        ),
        200,
        { page, limit: 100, total, totalPages: 2 },
      );
    },
  });
  await screen.findByText('101 attachments');
  expect(env.requests).toHaveLength(1);
  await press('Load more attachments');
  await screen.findByText(
    'Attachments changed while loading. Reload the list to see the latest count.',
  );
  expect(screen.queryByText('101 attachments')).toBeNull();
  await press('Reload attachment list');
  await screen.findByText('102 attachments');
  expect(env.requests.filter(({ page }) => page === 2)).toHaveLength(2);
});

test('private native preview retains verified bytes until explicit close; sharing cleans at completion', async () => {
  const file = attachment({
    kind: 'FILE',
    url: null,
    originalFilename: 'note.txt',
    mimeType: 'text/plain',
    byteSize: 5,
  });
  const env = await setup({ rows: [file], readOnly: true });
  const dispose = jest.fn();
  savePrivateDownload.mockReturnValue({
    uri: 'file:///private/note.txt',
    dispose,
  });
  jest.spyOn(env.data.api, 'binary').mockResolvedValue({
    bytes: new Uint8Array([78, 111, 116, 101, 115]).buffer,
    contentType: 'text/plain',
    contentLength: 5,
  });
  await screen.findByText('Design prototype');
  await press('Open private file Design prototype, Text document · 5 B');
  await screen.findByRole('button', { name: 'Close private file' });
  expect(previewPrivateFile).toHaveBeenCalled();
  expect(dispose).not.toHaveBeenCalled();
  await press('Close private file');
  expect(dispose).toHaveBeenCalledTimes(1);
  await press('Attachment options for Design prototype');
  await press('Share private file');
  expect(sharePrivateFile).toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(2);
});
test('late selection after revoke disposes the returned snapshot without reserving an upload', async () => {
  const selected = deferred(),
    dispose = jest.fn();
  selectPrivateFile.mockImplementation(() => selected.promise);
  const env = await setup();
  await screen.findByText('No attachments');
  await press('Add attachment');
  await press('Choose private file');
  await act(() => env.data.resources.fenceBoard(boardId, true));
  await act(() =>
    selected.resolve({
      uri: 'file:///private/note.txt',
      filename: 'note.txt',
      contentType: 'text/plain',
      fileSize: 5,
      dispose,
    }),
  );
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(env.requests.filter(({ method }) => method === 'POST')).toHaveLength(
    0,
  );
});
test('known 20-slot card limit blocks Add while retaining readable attachments', async () => {
  await setup({
    rows: Array.from({ length: 20 }, (_, i) =>
      attachment({ id: uuid(12000 + i) }),
    ),
  });
  await screen.findByText('20 attachments');
  expect(
    screen.getByRole('button', { name: 'Add attachment' }).props
      .accessibilityState.disabled,
  ).toBe(true);
  expect(screen.getAllByText('Design prototype')).toHaveLength(20);
});
test('remove conflict reloads a fresh confirmation instead of switching to the edit form', async () => {
  let deletes = 0;
  await setup({
    rows: [attachment()],
    override: ({ path, method }) => {
      if (method === 'DELETE' && ++deletes === 1)
        return failure(409, 'ATTACHMENT_REVISION_CONFLICT');
      if (path === `${base}/${attachmentId}` && method === 'GET')
        return response(
          attachment({ revision: 2, displayName: 'Latest link' }),
        );
      return null;
    },
  });
  await screen.findByText('Design prototype');
  await press('Attachment options for Design prototype');
  await press('Remove attachment');
  await press('Confirm remove attachment');
  await press('Reload attachment');
  await screen.findByText(
    'Remove “Latest link” from this card? Other people may be using it.',
  );
  expect(screen.queryByLabelText('HTTPS URL')).toBeNull();
  await press('Confirm remove attachment');
  await screen.findByText('No attachments');
  expect(deletes).toBe(2);
});
test('quota rejection retains the link draft and permits a later explicit retry', async () => {
  let posts = 0;
  await setup({
    override: ({ path, method }) =>
      path === base && method === 'POST' && ++posts === 1
        ? failure(409, 'ATTACHMENT_LIMIT_REACHED')
        : null,
  });
  await screen.findByText('No attachments');
  await press('Add attachment');
  await press('Add HTTPS link');
  await fireEvent.changeText(
    screen.getByLabelText('HTTPS URL'),
    'https://example.test/prototype',
  );
  await press('Save attachment');
  await screen.findByText(
    'Attachment quota reached: 20 per card or 100 MiB per board. Images reserve 10 MiB.',
  );
  expect(screen.getByLabelText('HTTPS URL').props.value).toBe(
    'https://example.test/prototype',
  );
  await press('Save attachment');
  await screen.findByText('example.test');
  expect(posts).toBe(2);
});

test('section loads actual rows, safe metadata and native HTTPS open only on explicit press', async () => {
  jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const gate = deferred();
  const env = await setup({
    override: ({ path }) => (path === base ? gate.promise : null),
  });
  expect(screen.getByLabelText('Loading attachments')).toBeTruthy();
  await act(() =>
    gate.resolve(
      response([attachment()], 200, {
        page: 1,
        limit: 100,
        total: 1,
        totalPages: 1,
      }),
    ),
  );
  await screen.findByText('Design prototype');
  expect(open).not.toHaveBeenCalled();
  await press('Open link Design prototype, example.test · Link attachment');
  expect(open).toHaveBeenCalledWith('https://example.test/prototype');
  expect(env.requests.filter(({ method }) => method === 'GET')).toHaveLength(1);
});
test('HTTPS validation, dirty cancel, save, explicit removal confirmation and authoritative count', async () => {
  const env = await setup();
  await screen.findByText('No attachments');
  await press('Add attachment');
  await press('Add HTTPS link');
  await fireEvent.changeText(
    screen.getByLabelText('HTTPS URL'),
    'javascript:alert(1)',
  );
  await press('Save attachment');
  await screen.findByText(
    'Enter an HTTPS URL without credentials or control characters.',
  );
  expect(env.requests.filter(({ method }) => method === 'POST')).toHaveLength(
    0,
  );
  await fireEvent.changeText(
    screen.getByLabelText('HTTPS URL'),
    'https://example.test/prototype',
  );
  await fireEvent.changeText(
    screen.getByLabelText('Display name'),
    'Design prototype',
  );
  await press('Cancel');
  await screen.findByText('Discard attachment draft?');
  await press('Keep editing');
  await press('Save attachment');
  await screen.findByText('Design prototype');
  await screen.findByText('1 attachment');
  await press('Attachment options for Design prototype');
  await press('Remove attachment');
  expect(env.requests.filter(({ method }) => method === 'DELETE')).toHaveLength(
    0,
  );
  await press('Confirm remove attachment');
  await screen.findByText('No attachments');
  expect(env.requests.filter(({ method }) => method === 'POST')).toHaveLength(
    1,
  );
  expect(env.requests.filter(({ method }) => method === 'DELETE')).toHaveLength(
    1,
  );
});
test('double submit/ambiguous URL POST retries original stable key and freezes its payload', async () => {
  const gate = deferred();
  let sends = 0;
  const env = await setup({
    override: ({ path, method }) => {
      if (path === base && method === 'POST') {
        sends++;
        if (sends === 1) return gate.promise;
      }
      return null;
    },
  });
  await screen.findByText('No attachments');
  await press('Add attachment');
  await press('Add HTTPS link');
  await fireEvent.changeText(
    screen.getByLabelText('HTTPS URL'),
    'https://example.test/prototype',
  );
  const save = screen.getByRole('button', { name: 'Save attachment' });
  await fireEvent.press(save);
  await fireEvent.press(save);
  expect(sends).toBe(1);
  await act(() =>
    gate.resolve(Promise.reject(new Error('native path never displayed'))),
  );
  await screen.findByText(
    'The result is uncertain. Retry this operation to check it safely.',
  );
  expect(screen.getByLabelText('HTTPS URL').props.editable).toBe(false);
  await press('Retry original link');
  await screen.findByText('example.test');
  const posts = env.requests.filter(({ method }) => method === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts[0].headers['Idempotency-Key']).toEqual(
    posts[1].headers['Idempotency-Key'],
  );
});
test('revision conflict reloads current metadata and requires a new reviewed save', async () => {
  let patches = 0;
  const env = await setup({
    rows: [attachment()],
    override: ({ method }) =>
      method === 'PATCH' && ++patches === 1
        ? failure(409, 'ATTACHMENT_REVISION_CONFLICT')
        : null,
  });
  await screen.findByText('Design prototype');
  await press('Attachment options for Design prototype');
  await press('Edit attachment');
  await fireEvent.changeText(screen.getByLabelText('Display name'), 'New name');
  await press('Save attachment');
  await screen.findByText(
    'This attachment changed. Reload it and review before saving again.',
  );
  expect(screen.getByLabelText('Display name').props.value).toBe('New name');
  await press('Reload attachment');
  expect(screen.getByLabelText('Display name').props.value).toBe(
    'Design prototype',
  );
  await fireEvent.changeText(screen.getByLabelText('Display name'), 'Reviewed');
  await press('Save attachment');
  await screen.findByText('Reviewed');
  expect(
    env.requests.filter(({ method }) => method === 'PATCH')[0].body
      .expectedRevision,
  ).toBe(1);
});
test.each([{ readOnly: true }, { archived: true }])(
  'read-only/archived retains authorized read actions and hides mutations %o',
  async (state) => {
    const env = await setup({ ...state, rows: [attachment()] });
    await screen.findByText('Design prototype');
    expect(screen.queryByRole('button', { name: 'Add attachment' })).toBeNull();
    await press('Attachment options for Design prototype');
    expect(
      screen.getByRole('button', { name: 'Open HTTPS link' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Edit attachment' }),
    ).toBeNull();
    expect(env.requests.every(({ method }) => method === 'GET')).toBe(true);
  },
);
test('picker cancellation is quiet; upload shows verifying until 200 ACTIVE and refetch', async () => {
  const complete = deferred();
  const dispose = jest.fn();
  const activeFile = attachment({
    kind: 'FILE',
    url: null,
    originalFilename: 'note.txt',
    mimeType: 'text/plain',
    byteSize: 5,
  });
  let active = false;
  const env = await setup({
    override: ({ path, method }) => {
      if (path.endsWith('/uploads') && method === 'POST')
        return response(
          {
            uploadId: attachmentId,
            state: 'PENDING',
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
            upload: {
              kind: 's3',
              url: 'https://storage.example.test',
              fields: { key: 'opaque' },
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          },
          201,
        );
      if (path.endsWith('/complete')) return complete.promise;
      if (path === base && method === 'GET' && active)
        return response([activeFile], 200, {
          page: 1,
          limit: 100,
          total: 1,
          totalPages: 1,
        });
      return null;
    },
  });
  await screen.findByText('No attachments');
  await press('Add attachment');
  await press('Choose private file');
  await screen.findByText('Upload canceled.');
  expect(env.requests.filter(({ method }) => method === 'POST')).toHaveLength(
    0,
  );
  selectPrivateFile.mockResolvedValue({
    uri: 'file:///private/note.txt',
    filename: 'note.txt',
    contentType: 'text/plain',
    fileSize: 5,
    dispose,
  });
  nativeTransferPorts.externalFetch.mockResolvedValue({ status: 204 });
  await press('Add attachment');
  await press('Choose private file');
  await screen.findByText('Verifying file with the server…');
  expect(screen.queryByText('File verified and attached.')).toBeNull();
  expect(screen.queryByText('Design prototype')).toBeNull();
  active = true;
  await act(() => complete.resolve(response(activeFile)));
  await screen.findByText('Design prototype');
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(
    screen.getAllByText('File verified and attached.').length,
  ).toBeGreaterThan(0);
});
test('background aborts transfer; explicit cancel disposes source and calls owned DELETE', async () => {
  let changed;
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      changed = listener;
      return { remove() {} };
    });
  const dispose = jest.fn(),
    transfer = deferred();
  selectPrivateFile.mockResolvedValue({
    uri: 'file:///private/note.txt',
    filename: 'note.txt',
    contentType: 'text/plain',
    fileSize: 5,
    dispose,
  });
  nativeTransferPorts.externalFetch.mockImplementation(() => transfer.promise);
  const env = await setup({
    override: ({ path }) =>
      path.endsWith('/uploads')
        ? response(
            {
              uploadId: attachmentId,
              state: 'PENDING',
              expiresAt: new Date(Date.now() + 900_000).toISOString(),
              upload: {
                kind: 's3',
                url: 'https://storage.example.test',
                fields: {},
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
              },
            },
            201,
          )
        : null,
  });
  await screen.findByText('No attachments');
  await press('Add attachment');
  await press('Choose private file');
  await screen.findByText('Uploading file…');
  // The hook owns its AppState subscription; invoke each registered attachment listener.
  const listeners = AppState.addEventListener.mock.calls.map(
    ([, listener]) => listener,
  );
  await act(() => {
    for (const listener of listeners) listener('background');
  });
  await screen.findByText('Upload canceled.');
  await press('Cancel upload');
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(
    env.requests.some(
      ({ method, path }) => method === 'DELETE' && path.endsWith(attachmentId),
    ),
  ).toBe(true);
  transfer.resolve({ status: 204 });
  expect(changed).toBeTruthy();
});
test('account switch and board revoke stop upload and remove owned temporary source', async () => {
  const dispose = jest.fn();
  const transfer = deferred();
  selectPrivateFile.mockResolvedValue({
    uri: 'file:///private/note.txt',
    filename: 'note.txt',
    contentType: 'text/plain',
    fileSize: 5,
    dispose,
  });
  nativeTransferPorts.externalFetch.mockImplementation(() => transfer.promise);
  const env = await setup({
    override: ({ path }) =>
      path.endsWith('/uploads')
        ? response(
            {
              uploadId: attachmentId,
              state: 'PENDING',
              expiresAt: new Date(Date.now() + 900_000).toISOString(),
              upload: {
                kind: 's3',
                url: 'https://storage.example.test',
                fields: {},
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
              },
            },
            201,
          )
        : null,
  });
  await screen.findByText('No attachments');
  await press('Add attachment');
  await press('Choose private file');
  await screen.findByText('Uploading file…');
  await act(() => env.data.resources.fenceBoard(boardId, true));
  expect(dispose).toHaveBeenCalledTimes(1);
  await act(() => env.manager.establishSession(loginResponse(USER_B)));
  expect(clearPrivateAttachmentFiles).toHaveBeenCalled();
  transfer.resolve({ status: 204 });
  expect(
    env.requests.filter(({ path }) => path.endsWith('/complete')),
  ).toHaveLength(0);
});
test('section failure/retry and offline remain local, dark theme/320dp/160% text use MOB-02 tokens', async () => {
  let error = true;
  const original = Dimensions.get('window');
  await act(() =>
    Dimensions.set({ window: { ...original, width: 320, fontScale: 1.6 } }),
  );
  try {
    const env = await setup({
      mode: 'dark',
      override: ({ path }) =>
        path === base && error
          ? failure(422, 'ATTACHMENT_CONTENT_INVALID')
          : null,
    });
    await screen.findByText('Couldn’t load attachments');
    error = false;
    await press('Retry attachments');
    await screen.findByText('No attachments');
    const header = screen.getByRole('header', { name: 'Attachments' });
    expect(StyleSheet.flatten(header.props.style).color).toBe(
      palettes.dark.text,
    );
    expect(header.props.allowFontScaling).not.toBe(false);
    expect(header.props.numberOfLines).toBeUndefined();
    await act(() => onlineManager.setOnline(false));
    expect(
      screen.getByRole('button', { name: 'Add attachment' }).props
        .accessibilityState.disabled,
    ).toBe(true);
    expect(env.requests.every(({ method }) => method === 'GET')).toBe(true);
  } finally {
    await act(() => Dimensions.set({ window: original }));
  }
});

test('a sibling comment author-only 403 does not abort an in-flight attachment save (MOB-28)', async () => {
  const gate = deferred();
  const env = await setup({
    override: ({ path, method }) =>
      path === base && method === 'POST' ? gate.promise : null,
  });
  await screen.findByText('No attachments');
  await press('Add attachment');
  await press('Add HTTPS link');
  await fireEvent.changeText(
    screen.getByLabelText('HTTPS URL'),
    'https://example.test/prototype',
  );
  await press('Save attachment');
  const identity = env.data.getIdentity();
  await act(() =>
    env.data.resources.denied([
      ...queryKeys.comments(identity, boardId, cardId),
      'write',
    ]),
  );
  await act(async () =>
    gate.resolve(response(attachment({ displayName: 'example.test' }), 201)),
  );
  // Saved: the sheet closed and the list was refetched, with no abort error.
  expect(screen.queryByLabelText('HTTPS URL')).toBeNull();
  expect(
    env.requests.filter(({ path, method }) => path === base && method === 'GET')
      .length,
  ).toBeGreaterThan(1);
});
