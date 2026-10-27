import { describe, expect, it, vi } from 'vitest';
import { transferAvatar, type AvatarIntent } from './avatar-api';

const id = '00000000-0000-4000-8000-000000000103';
const file = new File(['image'], 'photo.png', { type: 'image/png' });
describe('avatar transfer security', () => {
  it('sends JWT only to the exact local API upload route and lets FormData set its boundary', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const intent: AvatarIntent = {
      uploadId: id,
      expiresAt: '',
      upload: {
        kind: 'memory',
        url: `/users/me/avatar/uploads/${id}/file`,
        fields: {},
      },
    };
    await transferAvatar(
      intent,
      file,
      new AbortController().signal,
      'local-jwt',
    );
    expect(fetch.mock.calls[0][1].headers).toEqual({
      Authorization: 'Bearer local-jwt',
    });
    intent.upload.url = 'https://evil.example/steal';
    await expect(
      transferAvatar(intent, file, new AbortController().signal, 'local-jwt'),
    ).rejects.toThrow(/target/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects HTTP targets and does not display S3 XML errors', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('<Error>signed secret</Error>', { status: 403 }),
      );
    vi.stubGlobal('fetch', fetch);
    const intent: AvatarIntent = {
      uploadId: id,
      expiresAt: '',
      upload: { kind: 's3', url: 'http://unsafe.example/', fields: {} },
    };
    await expect(
      transferAvatar(intent, file, new AbortController().signal),
    ).rejects.toThrow(/target/);
    expect(fetch).not.toHaveBeenCalled();
    intent.upload.url = 'https://test.example/';
    await expect(
      transferAvatar(intent, file, new AbortController().signal),
    ).rejects.toMatchObject({
      status: 403,
      message: 'Could not transfer the photo. Choose it again and retry.',
    });
  });
});
