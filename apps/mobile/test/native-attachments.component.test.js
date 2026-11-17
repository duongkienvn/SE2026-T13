/* global jest, test, expect, beforeEach */
import { TextEncoder } from 'node:util';
import { File, __files, __state } from 'expo-file-system';
import { getDocumentAsync } from 'expo-document-picker';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import {
  clearPrivateAttachmentFiles,
  selectPrivateFile,
  savePrivateDownload,
  sharePrivateFile,
  previewPrivateFile,
} from '../src/features/cards/attachments/native';
import { ApiError } from '../src/infrastructure/api/errors';
import { FILE_LIMIT } from '../src/features/cards/attachments/policy';
import { deferred } from './auth/support';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-crypto', () => {
  let id = 0;
  return { randomUUID: () => `owned-${++id}` };
});
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));
jest.mock('expo-file-system', () => {
  const files = new Map();
  const state = { failDelete: false, failWrite: false, reads: 0 };
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
      for (const key of files.keys())
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
    get type() {
      return files.get(this.uri)?.type ?? 'text/plain';
    }
    get size() {
      return (
        files.get(this.uri)?.size ?? files.get(this.uri)?.bytes?.length ?? 0
      );
    }
    create() {
      files.set(this.uri, { bytes: new Uint8Array() });
    }
    write(bytes) {
      if (state.failWrite) throw new Error('device full /private/path');
      files.set(this.uri, { bytes: bytes.slice() });
    }
    bytes() {
      return Promise.resolve(files.get(this.uri)?.bytes);
    }
    canPreview() {
      return Promise.resolve(true);
    }
    preview(options) {
      state.preview = { uri: this.uri, ...options };
      return Promise.resolve();
    }
    readableStream() {
      const bytes = files.get(this.uri)?.bytes;
      let read = false;
      return {
        getReader: () => ({
          read: async () => {
            state.reads++;
            if (read) return { done: true };
            read = true;
            return { done: false, value: bytes };
          },
          cancel: async () => {},
        }),
      };
    }
    delete() {
      if (state.failDelete) throw new Error('private path');
      files.delete(this.uri);
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
const bytes = new TextEncoder().encode('A note');
const pickerUri = 'file:///app/cache/DocumentPicker/selection.txt';
const check = () => {};
test('native private viewer uses File.canPreview and File.preview after the session check', async () => {
  const temp = savePrivateDownload(bytes, { originalFilename: 'note.txt' });
  await previewPrivateFile(temp.uri, 'text/plain', check);
  expect(__state.preview).toEqual({
    uri: temp.uri,
    mimeType: 'text/plain',
    title: 'Private attachment',
  });
  await expect(
    previewPrivateFile(temp.uri, 'text/plain', () => {
      throw new ApiError('session-changed');
    }),
  ).rejects.toMatchObject({ kind: 'session-changed' });
  temp.dispose();
});
function picked(patch = {}) {
  __files.set(pickerUri, { bytes, type: 'text/plain' });
  getDocumentAsync.mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: pickerUri,
        name: 'notes.txt',
        mimeType: 'text/plain',
        size: bytes.length,
        ...patch,
      },
    ],
  });
}
beforeEach(() => {
  __state.failDelete = false;
  __state.failWrite = false;
  __state.reads = 0;
  clearPrivateAttachmentFiles();
  __files.clear();
  getDocumentAsync.mockReset();
  shareAsync.mockClear();
  isAvailableAsync.mockResolvedValue(true);
  globalThis.TextEncoder ??= TextEncoder;
});
test('native picker validates actual bytes and keeps only owned snapshot until disposed', async () => {
  picked();
  const file = await selectPrivateFile(check);
  expect(file.fileSize).toBe(bytes.length);
  expect(file.filename).toBe('notes.txt');
  expect(file.uri).toMatch(
    /^file:\/\/\/app\/cache\/kanvexa-private-attachments\/owned-/,
  );
  expect(__files.has(pickerUri)).toBe(false);
  expect(await new File(file.uri).bytes()).toEqual(bytes);
  expect(getDocumentAsync).toHaveBeenCalledWith(
    expect.objectContaining({ multiple: false, copyToCacheDirectory: true }),
  );
  file.dispose();
  expect(__files.has(file.uri)).toBe(false);
});
test('picker cancel never reads or creates an owned file', async () => {
  getDocumentAsync.mockResolvedValue({ canceled: true, assets: null });
  expect(await selectPrivateFile(check)).toBeNull();
  expect(__state.reads).toBe(0);
  expect(__files.size).toBe(0);
});
test.each([
  { name: '../../notes.txt' },
  { mimeType: 'application/pdf' },
  { size: 99 },
])(
  'untrusted picker declaration rejected and cache copy removed %o',
  async (patch) => {
    picked(patch);
    await expect(selectPrivateFile(check)).rejects.toBeInstanceOf(ApiError);
    expect(__files.has(pickerUri)).toBe(false);
  },
);
test('actual file size/bytes are checked independently; oversize rejected before reading', async () => {
  picked();
  __files.set(pickerUri, { size: FILE_LIMIT + 1, bytes });
  await expect(selectPrivateFile(check)).rejects.toBeInstanceOf(ApiError);
  expect(__state.reads).toBe(0);
  picked({ size: 1 });
  __files.set(pickerUri, { size: 1, bytes });
  await expect(selectPrivateFile(check)).rejects.toThrow('changed or exceeds');
  expect(__files.has(pickerUri)).toBe(false);
});
test('late OS picker after session change cleans copied bytes and never creates snapshot', async () => {
  const gate = deferred();
  getDocumentAsync.mockImplementation(() => gate.promise);
  let current = true;
  const pending = selectPrivateFile(() => {
    if (!current) throw new ApiError('session-changed');
  });
  current = false;
  __files.set(pickerUri, { bytes });
  gate.resolve({
    canceled: false,
    assets: [
      {
        uri: pickerUri,
        name: 'notes.txt',
        mimeType: 'text/plain',
        size: bytes.length,
      },
    ],
  });
  await expect(pending).rejects.toMatchObject({ kind: 'session-changed' });
  expect(__files.size).toBe(0);
});
test('private storage failure cleans partial files and never exposes native exception paths', () => {
  __state.failWrite = true;
  expect(() =>
    savePrivateDownload(bytes, { originalFilename: 'note.txt' }),
  ).toThrow('Could not save the private file. Check device storage.');
  expect(
    [...__files.keys()].filter((key) => key.endsWith('note.txt')),
  ).toHaveLength(0);
  __state.failWrite = false;
  const temp = savePrivateDownload(bytes, { originalFilename: 'note.txt' });
  __state.failDelete = true;
  temp.dispose();
  expect(() =>
    savePrivateDownload(bytes, { originalFilename: 'note.txt' }),
  ).toThrow('could not be cleared');
  __state.failDelete = false;
  clearPrivateAttachmentFiles();
  expect(__files.size).toBe(0);
});
test('native share has explicit availability/current-session checks and uses owned local URI', async () => {
  const temp = savePrivateDownload(bytes, { originalFilename: 'notes.txt' });
  await sharePrivateFile(temp.uri, 'text/plain', check);
  expect(shareAsync).toHaveBeenCalledWith(temp.uri, {
    mimeType: 'text/plain',
    dialogTitle: 'View or share private attachment',
  });
  shareAsync.mockClear();
  isAvailableAsync.mockResolvedValue(false);
  await expect(sharePrivateFile(temp.uri, 'text/plain', check)).rejects.toThrow(
    'unavailable',
  );
  expect(shareAsync).not.toHaveBeenCalled();
  isAvailableAsync.mockResolvedValue(true);
  await expect(
    sharePrivateFile(temp.uri, 'text/plain', () => {
      throw new ApiError('session-changed');
    }),
  ).rejects.toMatchObject({ kind: 'session-changed' });
  expect(shareAsync).not.toHaveBeenCalled();
  clearPrivateAttachmentFiles();
  expect(__files.size).toBe(0);
});
