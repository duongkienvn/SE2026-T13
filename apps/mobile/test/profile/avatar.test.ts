import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  avatarDeclaration,
  inspectAvatar,
  decodeAvatarIntent,
  transferAvatar,
  type AvatarIntent,
  type Photo,
} from '../../src/features/profile/avatar.ts';
import { createAvatarApi } from '../../src/features/profile/avatar-api.ts';
import { integration, json, ok } from '../realtime/integration-support.ts';
import { USER_A, USER_B } from '../auth/support.ts';
import { profileError } from '../../src/features/profile/status.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
const file: Photo = {
  uri: 'file:///private/photo.png',
  filename: 'photo.png',
  contentType: 'image/png',
  fileSize: 33,
  dispose() {},
};
const intent = (kind: 's3' | 'memory' = 'memory'): AvatarIntent => ({
  uploadId: USER_B,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  upload: {
    kind,
    url:
      kind === 'memory'
        ? `/users/me/avatar/uploads/${USER_B}/file`
        : 'https://bucket.s3.ap-southeast-1.amazonaws.com/',
    fields:
      kind === 'memory' ? {} : { key: 'signed-key', Policy: 'signed-policy' },
  },
});
test('avatar declarations and actual bytes are bounded and type checked', () => {
  assert.deepEqual(avatarDeclaration('image/png', 33), {
    contentType: 'image/png',
    fileSize: 33,
    filename: 'photo.png',
  });
  for (const size of [0, -1, 5 * 1024 * 1024 + 1, NaN])
    assert.throws(() => avatarDeclaration('image/png', size));
  for (const mime of ['image/gif', 'image/heic', 'image/svg+xml', 'IMAGE/PNG'])
    assert.throws(() => avatarDeclaration(mime, 1));
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 512);
  view.setUint32(20, 512);
  assert.doesNotThrow(() => inspectAvatar(bytes, 'image/png', 33));
  assert.throws(() => inspectAvatar(bytes, 'image/jpeg', 33));
  assert.throws(() => inspectAvatar(bytes, 'image/png', 32));
  view.setUint32(16, 8000);
  view.setUint32(20, 8000);
  assert.throws(() => inspectAvatar(bytes, 'image/png', 33));
});
test('intent rejects unsafe destinations, foreign memory IDs, malformed fields and stale grants', () => {
  const candidate = intent();
  assert.deepEqual(decodeAvatarIntent(candidate), candidate);
  for (const url of [
    'http://bucket.s3.amazonaws.com/',
    'https://attacker.test/',
    'https://user:pass@bucket.s3.amazonaws.com/',
    'https://bucket.s3.amazonaws.com/#x',
  ])
    assert.throws(() =>
      decodeAvatarIntent({
        ...intent('s3'),
        upload: { ...intent('s3').upload, url },
      }),
    );
  assert.throws(() =>
    decodeAvatarIntent({
      ...intent(),
      upload: {
        ...intent().upload,
        url: `/users/me/avatar/uploads/${USER_A}/file`,
      },
    }),
  );
  assert.throws(() =>
    decodeAvatarIntent({
      ...intent(),
      upload: { ...intent().upload, fields: { file: 'evil' } },
    }),
  );
});
test('memory uses authenticated 204 multipart, S3 uses ordered fields/file last without credentials', async () => {
  const env = await integration();
  try {
    const api = createAvatarApi(env.data.api, env.identity);
    env.respond(async (url, init) => {
      assert.equal(
        new URL(url).pathname,
        `/api/users/me/avatar/uploads/${USER_B}/file`,
      );
      assert.match(
        (init.headers as Record<string, string>).Authorization,
        /^Bearer /,
      );
      return new Response(null, { status: 204 });
    });
    const calls: string[][] = [];
    const ports = {
      now: Date.now,
      multipart: (_file: unknown, fields: Record<string, string>) => ({
        kind: 'native-upload' as const,
        createBody() {
          const body = new FormData();
          Object.entries(fields).forEach(([key, value]) =>
            body.append(key, value),
          );
          body.append('file', new Blob(['x']), 'photo.png');
          calls.push([...body.keys()]);
          return body;
        },
      }),
      externalFetch: (async (_url: unknown, init: RequestInit) => {
        assert.equal(init.credentials, 'omit');
        assert.equal(init.redirect, 'error');
        assert.equal(init.headers, undefined);
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    };
    await transferAvatar(
      api,
      intent(),
      file,
      ports,
      new AbortController().signal,
      () => {},
    );
    await transferAvatar(
      api,
      intent('s3'),
      file,
      ports,
      new AbortController().signal,
      () => {},
    );
    assert.deepEqual(calls, [['file'], ['key', 'Policy', 'file']]);
    await assert.rejects(() =>
      transferAvatar(
        api,
        { ...intent(), expiresAt: '2000-01-01T00:00:00Z' },
        file,
        ports,
        new AbortController().signal,
        () => {},
      ),
    );
  } finally {
    env.dispose();
  }
});
test('avatar intent/remove include expectedRevision; completion requires authoritative own user ACK', async () => {
  const env = await integration();
  try {
    const api = createAvatarApi(env.data.api, env.identity),
      signal = new AbortController().signal;
    env.respond(async (url, init) => {
      if (url.endsWith('/uploads')) {
        assert.deepEqual(JSON.parse(init.body as string), {
          contentType: 'image/png',
          fileSize: 33,
          expectedRevision: 7,
        });
        return json(
          {
            success: true,
            statusCode: 201,
            message: 'Created',
            data: intent(),
          },
          201,
        );
      }
      assert.equal(init.method, 'DELETE');
      assert.deepEqual(JSON.parse(init.body as string), {
        expectedRevision: 7,
      });
      return ok({
        id: USER_A,
        email: 'a@example.com',
        displayName: 'Alex',
        avatarUrl: null,
        avatarRevision: 8,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
    });
    await api.intent(file, 7, signal);
    assert.equal((await api.remove(7, signal)).avatarRevision, 8);
    env.respond(async () => ok({ id: USER_B }));
    await assert.rejects(() => api.complete(USER_B, signal));
  } finally {
    env.dispose();
  }
});

for (const status of [409, 413, 415, 422, 429, 503]) {
  test(`avatar completion ${status} never becomes a successful profile or exposes server text`, async () => {
    const env = await integration();
    try {
      env.respond(async () =>
        json(
          {
            success: false,
            statusCode: status,
            code: 'AVATAR_REJECTED',
            message: 'private signed form contents',
          },
          status,
        ),
      );
      await assert.rejects(
        () =>
          createAvatarApi(env.data.api, env.identity).complete(
            USER_B,
            new AbortController().signal,
          ),
        (error: unknown) =>
          error instanceof ApiError &&
          error.status === status &&
          !profileError(error).includes('private signed'),
      );
    } finally {
      env.dispose();
    }
  });
}
test('S3 redirect/error outcome is rejected without parsing XML or claiming completion', async () => {
  const env = await integration();
  try {
    let complete = 0;
    env.respond(async () => {
      complete++;
      return ok({});
    });
    await assert.rejects(() =>
      transferAvatar(
        createAvatarApi(env.data.api, env.identity),
        intent('s3'),
        file,
        {
          now: Date.now,
          multipart: () => ({
            kind: 'native-upload',
            createBody: () => new FormData(),
          }),
          externalFetch: (async () =>
            new Response('<XML>private</XML>', {
              status: 307,
            })) as typeof fetch,
        },
        new AbortController().signal,
        () => {},
      ),
    );
    assert.equal(complete, 0);
  } finally {
    env.dispose();
  }
});
