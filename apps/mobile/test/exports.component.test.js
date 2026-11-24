/* global jest, test, expect, afterEach, Response, URL */
import { TextEncoder } from 'node:util';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { BoardRole } from '@kanban/shared';
import { __files, __state } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { DataPrivacyScreen } from '../src/features/exports/DataPrivacyScreen';
import { BoardExportSection } from '../src/features/exports/BoardExportSection';
import { clearPrivateExportFiles } from '../src/features/exports/native';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { integration, json } from './realtime/integration-support';
import { flush } from './auth/support';
import { parsePath, destinationPath } from '../src/navigation/routes';
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useFocusEffect: (fn) => jest.requireActual('react').useEffect(fn, [fn]),
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
    push: mockPush,
  }),
  useIsFocused: () => true,
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
jest.mock('expo-crypto', () => {
  let id = 0;
  return { randomUUID: () => `export-${++id}` };
});
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));
jest.mock('expo-file-system', () => {
  const files = new Map();
  const state = { failDelete: false, failWrite: false, preview: null };
  const path = (parts) =>
    parts
      .map((part) => (typeof part === 'string' ? part : part.uri))
      .reduce(
        (result, part) =>
          result ? result.replace(/\/$/, '') + '/' + part : part,
        '',
      );
  class Directory {
    constructor(...parts) {
      this.uri = path(parts);
    }
    get exists() {
      return [...files.keys()].some(
        (key) => key === this.uri || key.startsWith(this.uri + '/'),
      );
    }
    create() {
      files.set(this.uri, { directory: true });
    }
    delete() {
      if (state.failDelete) throw new Error('private path');
      for (const key of [...files.keys()])
        if (key === this.uri || key.startsWith(this.uri + '/'))
          files.delete(key);
    }
  }
  class MockFile {
    constructor(...parts) {
      this.uri = path(parts);
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri)?.bytes?.length ?? 0;
    }
    create() {
      files.set(this.uri, { bytes: new Uint8Array() });
    }
    write() {
      throw new Error(
        'Async File.write must not hand out an incomplete private file',
      );
    }
    writeSync(bytes) {
      if (state.failWrite) throw new Error('device full /private/path');
      files.set(this.uri, { bytes: bytes.slice() });
    }
    canPreview() {
      return Promise.resolve(true);
    }
    preview(options) {
      state.preview = { uri: this.uri, ...options };
      return Promise.resolve();
    }
  }
  return {
    Directory,
    File: MockFile,
    Paths: { cache: { uri: 'file:///app/cache/' } },
    __files: files,
    __state: state,
  };
});

const BOARD = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const accountBytes = new TextEncoder().encode('{"schemaVersion":1}');
const exportFile = (bytes = accountBytes, type = 'application/json') =>
  new Response(bytes, {
    status: 200,
    headers: {
      'content-type': `${type}; charset=utf-8`,
      'content-length': String(bytes.length),
      'content-disposition': `attachment; filename="${
        type === 'text/csv'
          ? `kanvexa-board-${BOARD}-2026-11-22.csv`
          : 'kanvexa-account-2026-11-22.json'
      }"`,
    },
  });
const failure = (status, code) =>
  json(
    { success: false, statusCode: status, code, message: 'SECRET text' },
    status,
  );
const exportFiles = () =>
  [...__files.entries()].filter(
    ([key, value]) => key.includes('kanvexa-private-exports') && value.bytes,
  );
let cleanup;
async function setup(element, reply) {
  const env = await integration();
  const requests = [];
  env.respond(async (url, init) => {
    if (!new URL(url).pathname.endsWith('/export')) return null;
    requests.push({ url, init });
    return reply(url, requests.length);
  });
  const view = await render(
    <SessionProvider manager={env.manager}>
      <DataProvider layer={env.data}>{element(env)}</DataProvider>
    </SessionProvider>,
  );
  await act(() => focusManager.setFocused(true));
  cleanup = async () => {
    await view.unmount();
    env.dispose();
  };
  return { ...env, requests, view };
}
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  __state.failDelete = false;
  __state.failWrite = false;
  clearPrivateExportFiles();
  __files.clear();
  jest.clearAllMocks();
  onlineManager.setOnline(true);
});
const press = (name) => fireEvent.press(screen.getByRole('button', { name }));

test('Data & Privacy separates privacy, verified email and deletion from the existing export engine', async () => {
  const env = await setup(
    () => <DataPrivacyScreen />,
    () => exportFile(),
  );
  expect(screen.getByRole('header', { name: 'Your privacy' })).toBeTruthy();
  expect(screen.getByText(/Shared collaborative content remains/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Export my data (JSON)' }),
  ).toBeEnabled();
  for (const [label, path] of [
    ['Change email', '/change-email'],
    ['Delete account', '/delete-account'],
  ]) {
    await press(label);
    expect(mockPush).toHaveBeenLastCalledWith(path);
    expect(destinationPath(parsePath(path))).toBe(path);
  }
  expect(env.requests).toHaveLength(0);
});

test('account export saves exact bytes privately, shares on request, never claims saved', async () => {
  const env = await setup(
    () => <DataPrivacyScreen />,
    () => exportFile(),
  );
  expect(
    screen.getByText(/Board contents and uploaded files aren’t included/),
  ).toBeTruthy();
  await press('Export my data (JSON)');
  expect(
    await screen.findByText(/File ready: kanvexa-account-2026-11-22\.json/),
  ).toBeTruthy();
  expect(env.requests).toHaveLength(1);
  const [[uri, entry]] = exportFiles();
  expect(uri).toMatch(
    /^file:\/\/\/app\/cache\/kanvexa-private-exports\/export-\d+\/kanvexa-account-2026-11-22\.json$/,
  );
  expect(entry.bytes).toEqual(accountBytes);
  // Nothing is shared without an explicit tap.
  expect(shareAsync).not.toHaveBeenCalled();
  await press('Share or save');
  expect(shareAsync).toHaveBeenCalledWith(
    uri,
    expect.objectContaining({ mimeType: 'application/json' }),
  );
  expect(
    await screen.findByText(/can’t confirm whether a copy was saved/),
  ).toBeTruthy();
  expect(exportFiles()).toHaveLength(1);
  await press('Remove file');
  expect(exportFiles()).toHaveLength(0);
  expect(screen.getByText(/private copy was removed/)).toBeTruthy();
});

test('double tap sends one request; leaving the screen deletes the private file', async () => {
  let finish;
  const env = await setup(
    () => <DataPrivacyScreen />,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await press('Export my data (JSON)');
  await press('Export my data (JSON)');
  expect(screen.getByText(/Preparing your export/)).toBeTruthy();
  await act(async () => {
    finish(exportFile());
    await flush();
  });
  expect(env.requests).toHaveLength(1);
  expect(exportFiles()).toHaveLength(1);
  await env.view.unmount();
  expect(exportFiles()).toHaveLength(0);
});

test.each([
  ['Change email', '/change-email'],
  ['Delete account', '/delete-account'],
])(
  'opening %s removes the ready private export before pushing a new screen',
  async (label, path) => {
    await setup(
      () => <DataPrivacyScreen />,
      () => exportFile(),
    );
    await press('Export my data (JSON)');
    await screen.findByText(/File ready/);
    expect(exportFiles()).toHaveLength(1);
    await press(label);
    expect(exportFiles()).toHaveLength(0);
    expect(mockPush).toHaveBeenLastCalledWith(path);
    expect(shareAsync).not.toHaveBeenCalled();
  },
);

test.each(['logout', 'account-deleted', 'deletion-uncertain'])(
  'session end %s removes the ready file and the screen',
  async (reason) => {
    const env = await setup(
      () => <DataPrivacyScreen />,
      () => exportFile(),
    );
    await press('Export my data (JSON)');
    await screen.findByText(/File ready/);
    expect(exportFiles()).toHaveLength(1);
    await act(async () => {
      if (reason === 'logout') await env.manager.logout();
      else
        await env.manager.endAccountDeletion(
          env.identity.generation,
          reason === 'account-deleted',
        );
      await flush();
    });
    expect(exportFiles()).toHaveLength(0);
    expect(screen.queryByText(/File ready/)).toBeNull();
  },
);

test('413, wrong MIME and 429 leave zero files and show specific copy', async () => {
  let next = failure(413, 'EXPORT_TOO_LARGE');
  await setup(
    () => <DataPrivacyScreen />,
    () => next,
  );
  await press('Export my data (JSON)');
  expect(
    await screen.findByText(/exceeds 20 MiB\. Nothing was saved/),
  ).toBeTruthy();
  next = new Response('<html/>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
  await press('Export my data (JSON)');
  expect(
    await screen.findByText(/did not return a valid export file/),
  ).toBeTruthy();
  next = failure(429, 'TOO_MANY_REQUESTS');
  await press('Export my data (JSON)');
  expect(await screen.findByText(/Too many export requests/)).toBeTruthy();
  expect(screen.getByText(/You can export again in \d+ seconds/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Export my data (JSON)' }),
  ).toBeDisabled();
  expect(exportFiles()).toHaveLength(0);
  expect(screen.queryByText(/SECRET/)).toBeNull();
});

test('share unavailable gives actionable feedback; write failure saves nothing', async () => {
  isAvailableAsync.mockResolvedValueOnce(false);
  await setup(
    () => <DataPrivacyScreen />,
    () => exportFile(),
  );
  await press('Export my data (JSON)');
  await screen.findByText(/File ready/);
  await press('Share or save');
  expect(
    await screen.findByText(/Sharing isn’t available on this device/),
  ).toBeTruthy();
  expect(shareAsync).not.toHaveBeenCalled();
  await press('Open');
  expect(__state.preview).toEqual(
    expect.objectContaining({ mimeType: 'application/json' }),
  );
  await press('Remove file');
  __state.failWrite = true;
  await press('Export my data (JSON)');
  expect(await screen.findByText(/could not be saved privately/)).toBeTruthy();
  expect(exportFiles()).toHaveLength(0);
});

test('cleanup failure fences later exports before any network request', async () => {
  const env = await setup(
    () => <DataPrivacyScreen />,
    () => exportFile(),
  );
  await press('Export my data (JSON)');
  await screen.findByText(/File ready/);
  __state.failDelete = true;
  await press('Remove file');
  expect(
    screen.getByText(/could not be removed\. Restart the app/),
  ).toBeTruthy();
  await press('Export my data (JSON)');
  expect(
    await screen.findByText(/Restart the app before exporting again/),
  ).toBeTruthy();
  expect(env.requests).toHaveLength(1);
});

const identityOf = (env) => env.data.getIdentity();
test('Board export appears only for an explicit OWNER', async () => {
  for (const role of [BoardRole.MEMBER, null, undefined]) {
    await setup(
      (env) => (
        <BoardExportSection
          identity={identityOf(env)}
          boardId={BOARD}
          board={{ currentUserRole: role }}
        />
      ),
      () => exportFile(),
    );
    expect(screen.queryByText('Export board')).toBeNull();
    await cleanup();
    cleanup = null;
  }
});

test('OWNER exports CSV bytes exactly; server 403 removes the affordance', async () => {
  const csv = new TextEncoder().encode('﻿boardId,title\r\n1,"=1+1"\r\n');
  let reply = () => exportFile(csv, 'text/csv');
  const env = await setup(
    (env) => (
      <BoardExportSection
        identity={identityOf(env)}
        boardId={BOARD}
        board={{ currentUserRole: BoardRole.OWNER }}
      />
    ),
    () => reply(),
  );
  await fireEvent.press(screen.getByRole('radio', { name: 'CSV' }));
  await press('Export board (CSV)');
  expect(await screen.findByText(/File ready: kanvexa-board-/)).toBeTruthy();
  expect(new URL(env.requests[0].url).searchParams.get('format')).toBe('csv');
  expect(exportFiles()[0][1].bytes).toEqual(csv);
  await press('Remove file');
  reply = () => failure(403, 'FORBIDDEN');
  await press('Export board (CSV)');
  expect(
    await screen.findByText(/Only a current board owner can export/),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Export board/ })).toBeNull();
  expect(exportFiles()).toHaveLength(0);
});

test('session end deletes a ready Board export even while the section stays mounted', async () => {
  const env = await setup(
    (env) => (
      <BoardExportSection
        identity={identityOf(env)}
        boardId={BOARD}
        board={{ currentUserRole: BoardRole.OWNER }}
      />
    ),
    () => exportFile(),
  );
  await press('Export board (JSON)');
  await screen.findByText(/File ready/);
  expect(exportFiles()).toHaveLength(1);
  await act(async () => {
    await env.manager.logout();
    await flush();
  });
  expect(exportFiles()).toHaveLength(0);
});
