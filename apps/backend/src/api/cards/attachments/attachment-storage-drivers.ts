import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { ApplicationException } from '../../../exceptions/application.exception';
import {
  AttachmentStorage,
  type AttachmentStoredObject,
  type AttachmentUploadGrant,
  type AttachmentUploadReservation,
  type VerifiedAttachmentWrite,
} from './attachment-storage';
import type { AttachmentEnvironment } from './attachment.config';
import {
  ATTACHMENT_FILE_POLICY as POLICY,
  fileError,
} from './attachment-file-policy';

const storageFailure = () =>
  fileError(
    503,
    'ATTACHMENT_STORAGE_UNAVAILABLE',
    'Attachment storage is unavailable',
  );
function logicalKey(key: string, namespace?: 'pending' | 'active'): string {
  if (
    !/^attachments\/v1\/(pending|active)\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      key,
    ) ||
    (namespace && !key.startsWith(`attachments/v1/${namespace}/`))
  )
    throw storageFailure();
  return key;
}
function uploadExpiry(intentExpiry: Date): Date {
  const expires = Math.min(
    intentExpiry.getTime(),
    Date.now() + POLICY.postSeconds * 1000,
  );
  if (!Number.isFinite(expires) || expires - Date.now() < 1000)
    throw fileError(409, 'ATTACHMENT_UPLOAD_EXPIRED', 'Upload intent expired');
  return new Date(expires);
}

/** Bounds bytes and duration even when the provider header is dishonest. */
async function* boundedBody(
  body: AsyncIterable<Uint8Array>,
  expected: number,
  maximum: number,
  cancel: () => void,
): AsyncIterable<Uint8Array> {
  let size = 0;
  const timer = setTimeout(cancel, 30_000);
  timer.unref();
  try {
    for await (const chunk of body) {
      size += chunk.byteLength;
      if (size > maximum)
        throw fileError(
          413,
          'ATTACHMENT_TOO_LARGE',
          'Attachment exceeds its byte limit',
        );
      yield chunk;
    }
    if (size !== expected)
      throw fileError(
        422,
        'ATTACHMENT_CONTENT_INVALID',
        'Attachment size does not match stored content',
      );
  } catch (error) {
    if (error instanceof ApplicationException) throw error;
    throw storageFailure();
  } finally {
    clearTimeout(timer);
    cancel();
  }
}
export async function collectAttachmentBytes(
  object: AttachmentStoredObject,
  maximum: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of object.body) {
      size += chunk.byteLength;
      if (size > maximum)
        throw fileError(
          413,
          'ATTACHMENT_TOO_LARGE',
          'Attachment exceeds its byte limit',
        );
      chunks.push(Buffer.from(chunk));
    }
    if (size !== object.byteSize)
      throw fileError(
        422,
        'ATTACHMENT_CONTENT_INVALID',
        'Attachment size does not match stored content',
      );
    return Buffer.concat(chunks);
  } finally {
    object.cancel?.();
  }
}

export class MemoryAttachmentStorage extends AttachmentStorage {
  readonly kind = 'memory' as const;
  readonly available = true;
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  constructor(private readonly maximumBytes = 128 * 1024 * 1024) {
    super();
    if (process.env.NODE_ENV === 'production')
      throw new Error('Memory attachment storage is forbidden in production');
  }
  async createUploadGrant(
    input: AttachmentUploadReservation,
  ): Promise<AttachmentUploadGrant> {
    logicalKey(input.pendingKey, 'pending');
    return {
      kind: 'memory',
      url: '',
      fields: {},
      expiresAt: uploadExpiry(input.expiresAt),
    };
  }
  async upload(
    input: AttachmentUploadReservation,
    body: Buffer,
  ): Promise<void> {
    logicalKey(input.pendingKey, 'pending');
    uploadExpiry(input.expiresAt);
    if (body.length !== input.byteSize || body.length > POLICY.maximumFileBytes)
      throw fileError(
        413,
        'ATTACHMENT_SIZE_MISMATCH',
        'Upload size does not match its reservation',
      );
    this.put(input.pendingKey, body, input.mimeType);
  }
  async read(key: string, maximum: number): Promise<AttachmentStoredObject> {
    logicalKey(key);
    const value = this.objects.get(key);
    if (!value)
      throw fileError(
        404,
        'ATTACHMENT_OBJECT_NOT_FOUND',
        'Attachment object not found',
      );
    if (value.body.length > maximum)
      throw fileError(
        413,
        'ATTACHMENT_TOO_LARGE',
        'Attachment exceeds its byte limit',
      );
    const body = Buffer.from(value.body);
    const stream = Readable.from([body]);
    return {
      body: stream,
      cancel: () => {
        stream.destroy();
      },
      byteSize: body.length,
      contentType: value.contentType,
    };
  }
  async writeVerified(input: VerifiedAttachmentWrite): Promise<void> {
    logicalKey(input.storageKey, 'active');
    if (!input.ifAbsent || this.objects.has(input.storageKey))
      throw fileError(
        409,
        'ATTACHMENT_OBJECT_EXISTS',
        'Verified object already exists',
      );
    const body = await collectAttachmentBytes(
      {
        body: input.body,
        byteSize: input.byteSize,
        contentType: input.mimeType,
      },
      POLICY.maximumFileBytes,
    );
    if (this.objects.has(input.storageKey))
      throw fileError(
        409,
        'ATTACHMENT_OBJECT_EXISTS',
        'Verified object already exists',
      );
    this.put(input.storageKey, body, input.mimeType);
  }
  async delete(key: string): Promise<void> {
    logicalKey(key);
    this.objects.delete(key);
  }
  private put(key: string, body: Buffer, mime: string) {
    const total =
      [...this.objects.values()].reduce(
        (sum, object) => sum + object.body.length,
        0,
      ) - (this.objects.get(key)?.body.length ?? 0);
    if (total + body.length > this.maximumBytes) throw storageFailure();
    this.objects.set(key, { body: Buffer.from(body), contentType: mime });
  }
}

export class S3AttachmentStorage extends AttachmentStorage {
  readonly kind = 's3' as const;
  readonly available = true;
  private readonly client: S3Client;
  constructor(
    private readonly config: AttachmentEnvironment,
    client?: S3Client,
  ) {
    super();
    // No static credentials/endpoints: default SDK chain uses the EC2 instance role.
    this.client =
      client ??
      new S3Client({ region: config.ATTACHMENT_S3_REGION, maxAttempts: 2 });
  }
  private key(key: string, namespace?: 'pending' | 'active') {
    return `${this.config.ATTACHMENT_S3_PREFIX}/${logicalKey(key, namespace).slice('attachments/v1/'.length)}`;
  }
  async createUploadGrant(
    input: AttachmentUploadReservation,
  ): Promise<AttachmentUploadGrant> {
    const key = this.key(input.pendingKey, 'pending'),
      expiresAt = uploadExpiry(input.expiresAt);
    try {
      const target = await createPresignedPost(this.client, {
        Bucket: this.config.ATTACHMENT_S3_BUCKET,
        Key: key,
        Expires: Math.max(
          1,
          Math.floor((expiresAt.getTime() - Date.now()) / 1000),
        ),
        Fields: {
          'Content-Type': input.mimeType,
          'x-amz-server-side-encryption': 'AES256',
          success_action_status: '204',
        },
        Conditions: [
          ['eq', '$key', key],
          ['eq', '$Content-Type', input.mimeType],
          ['content-length-range', input.byteSize, input.byteSize],
          ['eq', '$x-amz-server-side-encryption', 'AES256'],
          ['eq', '$success_action_status', '204'],
        ],
      });
      return { kind: 's3', ...target, expiresAt };
    } catch {
      throw storageFailure();
    }
  }
  async read(key: string, maximum: number): Promise<AttachmentStoredObject> {
    const physical = this.key(key);
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.ATTACHMENT_S3_BUCKET,
          Key: physical,
        }),
        { abortSignal: AbortSignal.timeout(30_000) },
      );
      const body = result.Body as Readable | undefined;
      const cancel = () => {
        body?.destroy();
      };
      if (
        !body ||
        !Number.isSafeInteger(result.ContentLength) ||
        result.ContentLength! < 1
      ) {
        cancel();
        throw storageFailure();
      }
      if (result.ContentLength! > maximum) {
        cancel();
        throw fileError(
          413,
          'ATTACHMENT_TOO_LARGE',
          'Attachment exceeds its byte limit',
        );
      }
      return {
        body: boundedBody(body, result.ContentLength!, maximum, cancel),
        byteSize: result.ContentLength!,
        contentType: result.ContentType ?? '',
        cancel,
      };
    } catch (error) {
      if (error instanceof ApplicationException) throw error;
      if (
        error instanceof Error &&
        ['NoSuchKey', 'NotFound'].includes(error.name)
      )
        throw fileError(
          404,
          'ATTACHMENT_OBJECT_NOT_FOUND',
          'Attachment object not found',
        );
      throw storageFailure();
    }
  }
  async writeVerified(input: VerifiedAttachmentWrite): Promise<void> {
    const key = this.key(input.storageKey, 'active');
    if (!input.ifAbsent) throw storageFailure();
    const body = await collectAttachmentBytes(
      {
        body: input.body,
        byteSize: input.byteSize,
        contentType: input.mimeType,
      },
      POLICY.maximumFileBytes,
    );
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.ATTACHMENT_S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: input.mimeType,
          ContentLength: body.length,
          IfNoneMatch: '*',
          ServerSideEncryption: 'AES256',
          ChecksumSHA256: createHash('sha256').update(body).digest('base64'),
        }),
        { abortSignal: AbortSignal.timeout(30_000) },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'PreconditionFailed' ||
          ('\u0024metadata' in error &&
            (error as { $metadata: { httpStatusCode?: number } }).$metadata
              .httpStatusCode === 412))
      )
        throw fileError(
          409,
          'ATTACHMENT_OBJECT_EXISTS',
          'Verified object already exists',
        );
      throw storageFailure();
    }
  }
  async delete(key: string): Promise<void> {
    const physical = this.key(key);
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.config.ATTACHMENT_S3_BUCKET,
          Key: physical,
        }),
        { abortSignal: AbortSignal.timeout(30_000) },
      );
    } catch {
      throw storageFailure();
    }
  }
}
