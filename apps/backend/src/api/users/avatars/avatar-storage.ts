import { HttpStatus } from '@nestjs/common';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import {
  AVATAR_MAX_BYTES,
  AVATAR_POST_SECONDS,
  avatarError,
} from './avatar.constants';
import type { AvatarEnvironment } from './avatar.config';

export interface AvatarObject {
  body: Buffer;
  contentType: string;
}
export interface AvatarTarget {
  kind: 's3' | 'memory';
  url: string;
  fields: Record<string, string>;
}
export abstract class AvatarStorage {
  abstract readonly kind: 'disabled' | 'memory' | 's3';
  abstract presign(
    key: string,
    mime: string,
    size: number,
  ): Promise<AvatarTarget>;
  abstract get(key: string, maxBytes: number): Promise<AvatarObject>;
  abstract put(
    key: string,
    body: Buffer,
    mime: string,
    immutable?: boolean,
  ): Promise<void>;
  abstract delete(key: string): Promise<void>;
}

export class DisabledAvatarStorage extends AvatarStorage {
  readonly kind = 'disabled' as const;
  private unavailable(): never {
    throw avatarError(
      HttpStatus.SERVICE_UNAVAILABLE,
      'AVATAR_STORAGE_UNAVAILABLE',
      'Photo uploads are not configured.',
    );
  }
  presign(): Promise<AvatarTarget> {
    return this.unavailable();
  }
  get(): Promise<AvatarObject> {
    return this.unavailable();
  }
  put(): Promise<void> {
    return this.unavailable();
  }
  delete(): Promise<void> {
    return this.unavailable();
  }
}

/** Development/test only; bounded RAM, never the container filesystem. */
export class MemoryAvatarStorage extends AvatarStorage {
  readonly kind = 'memory' as const;
  readonly objects = new Map<string, AvatarObject>();
  async presign(): Promise<AvatarTarget> {
    return { kind: 'memory', url: '', fields: {} };
  }
  async get(key: string, maxBytes: number): Promise<AvatarObject> {
    const object = this.objects.get(key);
    if (!object)
      throw avatarError(
        404,
        'AVATAR_OBJECT_NOT_FOUND',
        'Photo upload not found.',
      );
    if (object.body.length > maxBytes)
      throw avatarError(
        413,
        'AVATAR_TOO_LARGE',
        'Photo exceeds the size limit.',
      );
    return { body: Buffer.from(object.body), contentType: object.contentType };
  }
  async put(
    key: string,
    body: Buffer,
    mime: string,
    immutable = false,
  ): Promise<void> {
    if (immutable && this.objects.has(key))
      throw avatarError(
        409,
        'AVATAR_OBJECT_EXISTS',
        'Photo object already exists.',
      );
    const total = [...this.objects.values()].reduce(
      (sum, item) => sum + item.body.length,
      0,
    );
    if (
      body.length > AVATAR_MAX_BYTES ||
      total + body.length > 64 * 1024 * 1024
    )
      throw avatarError(
        503,
        'AVATAR_STORAGE_UNAVAILABLE',
        'Local photo storage is full.',
      );
    this.objects.set(key, { body: Buffer.from(body), contentType: mime });
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export class S3AvatarStorage extends AvatarStorage {
  readonly kind = 's3' as const;
  private readonly client: S3Client;
  constructor(
    private readonly config: AvatarEnvironment,
    client?: S3Client,
  ) {
    super();
    this.client =
      client ??
      new S3Client({ region: config.AVATAR_S3_REGION, maxAttempts: 2 });
  }
  async presign(
    key: string,
    mime: string,
    size: number,
  ): Promise<AvatarTarget> {
    try {
      const target = await createPresignedPost(this.client, {
        Bucket: this.config.AVATAR_S3_BUCKET,
        Key: key,
        Expires: AVATAR_POST_SECONDS,
        Fields: {
          'Content-Type': mime,
          'x-amz-server-side-encryption': 'AES256',
          success_action_status: '204',
        },
        Conditions: [
          ['eq', '$key', key],
          ['eq', '$Content-Type', mime],
          ['content-length-range', size, size],
          ['eq', '$x-amz-server-side-encryption', 'AES256'],
          ['eq', '$success_action_status', '204'],
        ],
      });
      return { kind: 's3', ...target };
    } catch {
      throw avatarError(
        503,
        'AVATAR_STORAGE_UNAVAILABLE',
        'Photo storage could not authorize the upload.',
      );
    }
  }
  async get(key: string, maxBytes: number): Promise<AvatarObject> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.AVATAR_S3_BUCKET,
          Key: key,
        }),
        { abortSignal: AbortSignal.timeout(10_000) },
      );
      if (!result.Body || (result.ContentLength ?? Infinity) > maxBytes) {
        result.Body?.transformToWebStream()
          .cancel()
          .catch(() => undefined);
        throw avatarError(
          413,
          'AVATAR_TOO_LARGE',
          'Photo exceeds the size limit.',
        );
      }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        const part = Buffer.from(chunk);
        length += part.length;
        if (length > maxBytes)
          throw avatarError(
            413,
            'AVATAR_TOO_LARGE',
            'Photo exceeds the size limit.',
          );
        chunks.push(part);
      }
      return {
        body: Buffer.concat(chunks),
        contentType: result.ContentType ?? '',
      };
    } catch (error) {
      if (error instanceof Error && 'getStatus' in error) throw error;
      if (
        error instanceof Error &&
        ['NoSuchKey', 'NotFound'].includes(error.name)
      )
        throw avatarError(404, 'AVATAR_OBJECT_NOT_FOUND', 'Photo not found.');
      throw avatarError(
        503,
        'AVATAR_STORAGE_UNAVAILABLE',
        'Photo storage could not be reached.',
      );
    }
  }
  async put(
    key: string,
    body: Buffer,
    mime: string,
    immutable = false,
  ): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.AVATAR_S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: mime,
          ServerSideEncryption: 'AES256',
          ...(immutable ? { IfNoneMatch: '*' } : {}),
        }),
        { abortSignal: AbortSignal.timeout(10_000) },
      );
    } catch {
      throw avatarError(
        503,
        'AVATAR_STORAGE_UNAVAILABLE',
        'Photo storage could not save the image.',
      );
    }
  }
  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.config.AVATAR_S3_BUCKET,
          Key: key,
        }),
        { abortSignal: AbortSignal.timeout(10_000) },
      );
    } catch {
      throw avatarError(
        503,
        'AVATAR_STORAGE_UNAVAILABLE',
        'Photo cleanup could not reach storage.',
      );
    }
  }
}
