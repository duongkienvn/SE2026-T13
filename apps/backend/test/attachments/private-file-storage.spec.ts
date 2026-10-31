import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { validateAttachmentEnvironment } from '../../src/api/cards/attachments/attachment.config';
import {
  MemoryAttachmentStorage,
  S3AttachmentStorage,
  collectAttachmentBytes,
} from '../../src/api/cards/attachments/attachment-storage-drivers';

jest.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: jest.fn(),
}));
const config = validateAttachmentEnvironment({
  ATTACHMENT_STORAGE_DRIVER: 's3',
  ATTACHMENT_S3_BUCKET: 'test-private-files',
  ATTACHMENT_S3_PREFIX: 'private/cards/v1',
  ATTACHMENT_POLICY_ACK: 'v1',
});
const id = randomUUID(),
  pendingKey = `attachments/v1/pending/${id}`,
  storageKey = `attachments/v1/active/${id}`;
const reservation = () => ({
  pendingKey,
  mimeType: 'text/plain',
  byteSize: 5,
  expiresAt: new Date(Date.now() + 900_000),
});

describe('private file storage (mocked S3 only)', () => {
  it('constrains POST key/type/bytes/expiry and encryption without ACL or credentials', async () => {
    jest
      .mocked(createPresignedPost)
      .mockResolvedValue({
        url: 'https://test.invalid',
        fields: { Policy: 'test-only' },
      });
    const send = jest.fn();
    const storage = new S3AttachmentStorage(config, {
      send,
    } as unknown as S3Client);
    const grant = await storage.createUploadGrant(reservation());
    const request = jest.mocked(createPresignedPost).mock.calls.at(-1)![1];
    expect(request).toMatchObject({
      Bucket: 'test-private-files',
      Key: `private/cards/v1/pending/${id}`,
      Fields: {
        'Content-Type': 'text/plain',
        'x-amz-server-side-encryption': 'AES256',
      },
    });
    expect(request.Conditions).toEqual(
      expect.arrayContaining([
        ['eq', '$key', `private/cards/v1/pending/${id}`],
        ['content-length-range', 5, 5],
        ['eq', '$Content-Type', 'text/plain'],
      ]),
    );
    expect(request.Expires).toBeLessThanOrEqual(60);
    expect(grant.kind).toBe('s3');
    expect(send).not.toHaveBeenCalled();
    expect(request.Fields).not.toHaveProperty('acl');
  });
  it('bounds provider headers AND actual streaming bytes and cancels unusable streams', async () => {
    const oversized = Readable.from([Buffer.alloc(6)]),
      send = jest
        .fn()
        .mockResolvedValue({
          Body: oversized,
          ContentLength: 6,
          ContentType: 'text/plain',
        });
    const storage = new S3AttachmentStorage(config, {
      send,
    } as unknown as S3Client);
    await expect(storage.read(storageKey, 5)).rejects.toMatchObject({
      status: 413,
    });
    expect(oversized.destroyed).toBe(true);
    send.mockResolvedValue({
      Body: Readable.from([Buffer.alloc(6)]),
      ContentLength: 5,
      ContentType: 'text/plain',
    });
    await expect(
      collectAttachmentBytes(await storage.read(storageKey, 5), 5),
    ).rejects.toMatchObject({ status: 413 });
    send.mockResolvedValue({
      Body: Readable.from([Buffer.alloc(3)]),
      ContentLength: 5,
      ContentType: 'text/plain',
    });
    await expect(
      collectAttachmentBytes(await storage.read(storageKey, 5), 5),
    ).rejects.toMatchObject({ status: 422 });
    send.mockResolvedValue({
      Body: Readable.from([Buffer.from('hello')]),
      ContentLength: 5,
      ContentType: 'text/plain',
    });
    expect(
      (
        await collectAttachmentBytes(await storage.read(storageKey, 5), 5)
      ).toString(),
    ).toBe('hello');
  });
  it('writes immutable encrypted verified bytes, handles collisions and sanitizes provider errors', async () => {
    const send = jest.fn().mockResolvedValue({}),
      storage = new S3AttachmentStorage(config, {
        send,
      } as unknown as S3Client);
    await storage.writeVerified({
      storageKey,
      body: Readable.from([Buffer.from('hello')]),
      byteSize: 5,
      mimeType: 'text/plain',
      ifAbsent: true,
    });
    expect(send.mock.calls[0][0].input).toMatchObject({
      Key: `private/cards/v1/active/${id}`,
      IfNoneMatch: '*',
      ServerSideEncryption: 'AES256',
      ContentLength: 5,
    });
    expect(send.mock.calls[0][0].input).not.toHaveProperty('ACL');
    send.mockRejectedValue(
      Object.assign(new Error('secret key provider detail'), {
        name: 'PreconditionFailed',
      }),
    );
    await expect(
      storage.writeVerified({
        storageKey,
        body: Readable.from([Buffer.from('hello')]),
        byteSize: 5,
        mimeType: 'text/plain',
        ifAbsent: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
    send.mockRejectedValue(new Error('credential secret'));
    await expect(storage.delete(storageKey)).rejects.not.toThrow(
      /credential|secret/,
    );
    await expect(storage.read('../avatar', 5)).rejects.toMatchObject({
      status: 503,
    });
    await expect(
      storage.createUploadGrant({ ...reservation(), pendingKey: storageKey }),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('keeps memory bounded/ephemeral with exact upload sizes and immutable verified writes', async () => {
    const storage = new MemoryAttachmentStorage(12);
    await storage.upload(reservation(), Buffer.from('hello'));
    expect(
      (
        await collectAttachmentBytes(await storage.read(pendingKey, 5), 5)
      ).toString(),
    ).toBe('hello');
    await storage.writeVerified({
      storageKey,
      body: Readable.from([Buffer.from('hello')]),
      byteSize: 5,
      mimeType: 'text/plain',
      ifAbsent: true,
    });
    await expect(
      storage.writeVerified({
        storageKey,
        body: Readable.from([Buffer.from('other')]),
        byteSize: 5,
        mimeType: 'text/plain',
        ifAbsent: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      storage.upload({ ...reservation(), byteSize: 8 }, Buffer.alloc(8)),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      storage.upload(reservation(), Buffer.alloc(6)),
    ).rejects.toMatchObject({ status: 413 });
    await storage.delete(pendingKey);
    await storage.delete(pendingKey);
    await expect(storage.read(pendingKey, 5)).rejects.toMatchObject({
      status: 404,
    });
    expect(new MemoryAttachmentStorage().objects.size).toBe(0);
  });
});
