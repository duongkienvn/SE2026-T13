/* global jest, test, expect, beforeEach, AbortController */
import { launchImageLibraryAsync } from 'expo-image-picker';
import { Paths, __files, __state } from 'expo-file-system';
import {
  clearPrivateAvatarFiles,
  selectPrivatePhoto,
  savePrivateAvatar,
} from '../src/features/profile/native-media';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-crypto', () => {
  let id = 0;
  return { randomUUID: () => `random-${++id}` };
});
jest.mock('expo-file-system', () => {
  const files = new Map(),
    state = { failDelete: false, failWrite: false };
  const path = (parts) =>
    parts
      .map((v) => (typeof v === 'string' ? v : v.uri))
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
      return files.has(this.uri);
    }
    create() {
      files.set(this.uri, {});
    }
    delete() {
      if (state.failDelete) throw new Error('private');
      for (const key of files.keys())
        if (key === this.uri || key.startsWith(this.uri + '/'))
          files.delete(key);
    }
  }
  class File {
    constructor(...parts) {
      this.uri = path(parts);
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri)?.bytes?.length ?? 0;
    }
    get type() {
      return files.get(this.uri)?.type ?? 'image/png';
    }
    create() {
      files.set(this.uri, {});
    }
    async write(bytes) {
      await Promise.resolve();
      files.set(this.uri, { bytes: bytes.slice() });
    }
    writeSync(bytes) {
      if (state.failWrite) throw new Error('private write failed');
      files.set(this.uri, { bytes: bytes.slice() });
    }
    delete() {
      files.delete(this.uri);
    }
    readableStream() {
      let read = false;
      return {
        getReader: () => ({
          read: async () => {
            if (read) return { done: true };
            read = true;
            return { done: false, value: files.get(this.uri).bytes };
          },
          cancel: async () => {},
        }),
      };
    }
  }
  return {
    Directory,
    File,
    Paths: { cache: { uri: 'file:///cache/' } },
    __files: files,
    __state: state,
  };
});
const png = () => {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 10);
  view.setUint32(20, 10);
  return bytes;
};
beforeEach(() => {
  __state.failDelete = false;
  __state.failWrite = false;
  Paths.cache.uri = 'file:///cache/';
  clearPrivateAvatarFiles();
  __files.clear();
  launchImageLibraryAsync.mockReset();
});
test('closed photo picker is a non-error, no private file created', async () => {
  launchImageLibraryAsync.mockResolvedValue({ canceled: true });
  expect(
    await selectPrivatePhoto(() => {}, new AbortController().signal),
  ).toBeNull();
  expect(__files.size).toBe(0);
});
test('picker copy is inspected and removed; private snapshot disposed', async () => {
  const uri = 'file:///cache/picked.png';
  __files.set(uri, { bytes: png(), type: 'image/png' });
  launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [
      { uri, mimeType: 'image/png', fileSize: 33, width: 10, height: 10 },
    ],
  });
  const file = await selectPrivatePhoto(() => {}, new AbortController().signal);
  expect(file.uri).toMatch(/kanvexa-private-avatars/);
  expect(__files.has(uri)).toBe(false);
  file.dispose();
  expect(
    [...__files.keys()].filter((key) => key.endsWith('.png')),
  ).toHaveLength(0);
});
test('stale selection after sign-out deletes picker copy and never creates another-account file', async () => {
  const uri = 'file:///cache/picked.png';
  __files.set(uri, { bytes: png(), type: 'image/png' });
  const controller = new AbortController();
  launchImageLibraryAsync.mockImplementation(async () => {
    controller.abort();
    return {
      canceled: false,
      assets: [{ uri, mimeType: 'image/png', fileSize: 33 }],
    };
  });
  await expect(
    selectPrivatePhoto(() => {
      if (controller.signal.aborted) throw new Error('stale');
    }, controller.signal),
  ).rejects.toThrow();
  expect(__files.has(uri)).toBe(false);
});
test('session cleanup deletes downloads and fails closed when storage cannot be cleared', () => {
  const file = savePrivateAvatar(new Uint8Array([1, 2, 3]));
  expect(__files.has(file.uri)).toBe(true);
  __state.failDelete = true;
  clearPrivateAvatarFiles();
  expect(() => savePrivateAvatar(new Uint8Array([1]))).toThrow();
  __state.failDelete = false;
  clearPrivateAvatarFiles();
  expect(__files.size).toBe(0);
});

test('snapshot bytes are fully written before its URI is returned', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const file = savePrivateAvatar(bytes);
  expect(__files.get(file.uri).bytes).toEqual(bytes);
  file.dispose();
});
test('snapshot write failure deletes its directory and never returns a URI', () => {
  __state.failWrite = true;
  expect(() => savePrivateAvatar(new Uint8Array([1]))).toThrow();
  expect(
    [...__files.keys()].filter((uri) => uri.includes('/random-')),
  ).toHaveLength(0);
});
test('encoded trusted Expo Go cache prefix still permits cleanup of the picker copy', async () => {
  Paths.cache.uri = 'file:///cache/ExperienceData/%2540owner%252Fkanvexa/';
  const uri = Paths.cache.uri + 'ImagePicker/photo.png';
  __files.set(uri, { bytes: png(), type: 'image/png' });
  launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri, mimeType: 'image/png', fileSize: 33 }],
  });
  const selected = await selectPrivatePhoto(
    () => {},
    new AbortController().signal,
  );
  expect(__files.has(uri)).toBe(false);
  selected.dispose();
});
test.each([
  'file:///cache-adjacent/photo.png',
  'file:///original/photo.png',
  'content://picker/photo.png',
  'file:///cache/../original/photo.png',
  'file:///cache/./photo.png',
  'file:///cache/%2e%2e/photo.png',
  'file:///cache/%252e%252e/photo.png',
  'file:///cache/sub\\..\\original/photo.png',
  'file:///cache/photo.png?outside',
  'file:///cache/photo.png#outside',
])(
  'picker cleanup never deletes an original or an unsafe suffix: %s',
  async (uri) => {
    Paths.cache.uri = 'file:///cache';
    __files.set(uri, { bytes: png(), type: 'image/png' });
    launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri, mimeType: 'image/png', fileSize: 33 }],
    });
    const selected = await selectPrivatePhoto(
      () => {},
      new AbortController().signal,
    );
    expect(__files.has(uri)).toBe(true);
    selected.dispose();
  },
);
