/* global jest, test, expect, beforeAll, afterAll */
import { Blob as NodeBlob } from 'node:buffer';
import { setImmediate } from 'node:timers';
import { TextDecoder, TextEncoder } from 'node:util';
import RNFormData from 'react-native/Libraries/Network/FormData';
const { installFormDataPatch } = jest.requireActual('expo/src/winter/FormData');
const { normalizeBodyInitAsync } = jest.requireActual(
  'expo/src/winter/fetch/RequestUtils',
);
import { File } from 'expo-file-system';
import { createNativeMultipartUpload } from '../src/infrastructure/api/native-upload';
import { createHttpClient } from '../src/infrastructure/api/client';

// Only native file access is mocked; Expo's installed FormData patch and actual
// fetch multipart conversion are used, including bytes and boundary generation.
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri) => ({
    name: 'original.bin',
    type: 'application/octet-stream',
    bytes: async () => {
      if (uri === 'file:///missing.bin')
        throw new Error('Private file unavailable');
      return new Uint8Array([65, 0, 255, 66]);
    },
  })),
}));

const originalFormData = globalThis.FormData;
const originalBlob = globalThis.Blob;
beforeAll(() => {
  globalThis.TextEncoder ??= TextEncoder;
  globalThis.TextDecoder ??= TextDecoder;
  globalThis.FormData = installFormDataPatch(RNFormData);
  globalThis.Blob = NodeBlob;
});
afterAll(() => {
  globalThis.FormData = originalFormData;
  globalThis.Blob = originalBlob;
});

function clientFor(fetch) {
  return createHttpClient({
    baseUrl: new globalThis.URL('https://example.test/api'),
    fetch,
  });
}
const decode = (value) => value;
const success = () =>
  new globalThis.Response(
    JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'OK',
      data: 'uploaded',
    }),
    { headers: { 'content-type': 'application/json' } },
  );

test.each(['file:///private/cache/photo.bin', 'content://picker/photo/1'])(
  'converts %s into bytes through Expo multipart conversion, retaining string fields and metadata',
  async (uri) => {
    const unsupported = new globalThis.FormData();
    unsupported.append('file', { uri, name: 'photo.bin', type: 'image/png' });
    await expect(normalizeBodyInitAsync(unsupported)).rejects.toThrow(
      'Unsupported FormDataPart',
    );
    const upload = createNativeMultipartUpload([
      ['title', 'first'],
      ['file', { uri, name: 'photo.bin', type: 'image/png' }],
      ['title', 'second'],
    ]);
    const fetch = jest.fn(async (_url, init) => {
      expect(init.headers['Content-Type']).toBeUndefined();
      const normalized = await normalizeBodyInitAsync(init.body);
      const header = normalized.overriddenHeaders[0];
      expect(header[0]).toBe('Content-Type');
      const boundary = header[1].split('boundary=')[1];
      expect(boundary).toMatch(/^----ExpoFetchFormBoundary/);
      const text = new TextDecoder('latin1').decode(normalized.body);
      expect(text).toContain(`--${boundary}\r\n`);
      expect(text).toContain(
        'name="file"; filename="photo.bin"\r\ncontent-type: image/png',
      );
      expect(text).toContain('name="title"\r\n\r\nfirst');
      expect(text).toContain('name="title"\r\n\r\nsecond');
      expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
      const bytes = Array.from(normalized.body);
      expect(
        bytes.some(
          (value, i) =>
            value === 65 &&
            bytes[i + 1] === 0 &&
            bytes[i + 2] === 255 &&
            bytes[i + 3] === 66,
        ),
      ).toBe(true);
      return success();
    });
    await expect(
      clientFor(fetch).json('/upload', decode, { method: 'POST', upload }),
    ).resolves.toBe('uploaded');
    expect(File).toHaveBeenCalledWith(uri);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test('raw URI factories are rejected before fetch and supported Blob fields still convert', async () => {
  const form = new globalThis.FormData();
  form.append('file', { uri: 'file:///raw.bin' });
  const fetch = jest.fn();
  await expect(
    clientFor(fetch).json('/upload', decode, {
      method: 'POST',
      upload: { kind: 'native-upload', createBody: () => form },
    }),
  ).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetch).not.toHaveBeenCalled();
  const upload = createNativeMultipartUpload([
    ['file', new globalThis.Blob(['hello'], { type: 'text/plain' })],
  ]);
  const normalized = await normalizeBodyInitAsync(upload.createBody());
  expect(new TextDecoder().decode(normalized.body)).toContain('hello');
});

test('URI read failure is normalized without replay; cancellation during byte conversion prevents sending', async () => {
  const upload = createNativeMultipartUpload([
    ['file', { uri: 'file:///missing.bin' }],
  ]);
  const fetch = jest.fn(async (_url, init) => {
    await normalizeBodyInitAsync(init.body);
    return success();
  });
  await expect(
    clientFor(fetch).json('/upload', decode, { method: 'POST', upload }),
  ).rejects.toMatchObject({ kind: 'network' });
  expect(fetch).toHaveBeenCalledTimes(1);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  File.mockImplementationOnce(() => ({
    name: 'slow.bin',
    type: 'application/octet-stream',
    bytes: () => gate,
  }));
  let sent = 0;
  const controller = new globalThis.AbortController();
  const slow = jest.fn(async (_url, init) => {
    await normalizeBodyInitAsync(init.body);
    if (init.signal.aborted) throw new Error('Cancelled');
    sent++;
    return success();
  });
  const pending = clientFor(slow).json('/upload', decode, {
    method: 'POST',
    upload: createNativeMultipartUpload([
      ['file', { uri: 'file:///slow.bin' }],
    ]),
    signal: controller.signal,
  });
  const check = expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  controller.abort();
  await check;
  release(new Uint8Array([1]));
  await new Promise((resolve) => setImmediate(resolve));
  expect(sent).toBe(0);
  expect(slow).toHaveBeenCalledTimes(1);
});
