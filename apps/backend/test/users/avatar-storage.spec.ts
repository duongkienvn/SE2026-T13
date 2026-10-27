import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { S3AvatarStorage } from '../../src/api/users/avatars/avatar-storage';
import { validateAvatarEnvironment } from '../../src/api/users/avatars/avatar.config';

const config = validateAvatarEnvironment({
  AVATAR_STORAGE_DRIVER: 's3',
  AVATAR_S3_BUCKET: 'local-test-only',
});

describe('private S3 adapter without network', () => {
  it('signs a real scoped POST policy with test credentials, exact bytes, TTL and encryption', async () => {
    const client = new S3Client({
      region: 'ap-southeast-1',
      credentials: {
        accessKeyId: 'TEST_ONLY_NEVER_AWS',
        secretAccessKey: 'test-only-secret',
      },
    });
    const storage = new S3AvatarStorage(config, client);
    const before = Date.now();
    const target = await storage.presign(
      'avatars/v1/pending/user/random',
      'image/png',
      1234,
    );
    const policy = JSON.parse(
      Buffer.from(target.fields.Policy, 'base64').toString(),
    );
    expect(policy.conditions).toEqual(
      expect.arrayContaining([
        ['eq', '$key', 'avatars/v1/pending/user/random'],
        ['eq', '$Content-Type', 'image/png'],
        ['content-length-range', 1234, 1234],
        ['eq', '$x-amz-server-side-encryption', 'AES256'],
      ]),
    );
    expect(Date.parse(policy.expiration) - before).toBeLessThanOrEqual(60_000);
    expect(Date.parse(policy.expiration) - before).toBeGreaterThan(58_000);
    expect(target.fields).not.toHaveProperty('acl');
    expect(target.url).toMatch(/^https:/);
    client.destroy();
  });

  it('bounds streamed bytes even if S3 ContentLength lies', async () => {
    const body = Readable.from([Buffer.alloc(6), Buffer.alloc(6)]);
    const send = jest.fn().mockResolvedValue({
      Body: body,
      ContentLength: 2,
      ContentType: 'image/png',
    });
    const storage = new S3AvatarStorage(config, {
      send,
    } as unknown as S3Client);
    await expect(storage.get('pending', 10)).rejects.toMatchObject({
      status: 413,
    });
    expect(body.destroyed).toBe(true);
  });

  it('uses immutable encrypted writes and sanitizes infrastructure failures', async () => {
    const send = jest.fn().mockResolvedValue({});
    const storage = new S3AvatarStorage(config, {
      send,
    } as unknown as S3Client);
    await storage.put('active', Buffer.from('image'), 'image/webp', true);
    expect(send.mock.calls[0][0].input).toMatchObject({
      IfNoneMatch: '*',
      ServerSideEncryption: 'AES256',
    });
    send.mockRejectedValue(new Error('SECRET AWS SQL credentials stack'));
    await expect(storage.get('active', 100)).rejects.toMatchObject({
      status: 503,
      response: { message: 'Photo storage could not be reached.' },
    });
  });

  it('cannot enable live AWS from inherited test configuration or memory in production', () => {
    expect(
      validateAvatarEnvironment({
        NODE_ENV: 'test',
        AVATAR_STORAGE_DRIVER: 's3',
      }).AVATAR_STORAGE_DRIVER,
    ).toBe('disabled');
    expect(() =>
      validateAvatarEnvironment({
        NODE_ENV: 'production',
        AVATAR_STORAGE_DRIVER: 'memory',
      }),
    ).toThrow(/forbidden/);
    expect(() =>
      validateAvatarEnvironment({ AVATAR_S3_PREFIX: '../other' }),
    ).toThrow();
    expect(() =>
      validateAvatarEnvironment({ AVATAR_STORAGE_DRIVER: 's3' }),
    ).toThrow(/bucket/);
  });
});
