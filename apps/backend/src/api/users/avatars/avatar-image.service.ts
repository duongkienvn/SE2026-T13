import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import {
  AVATAR_MAX_BYTES,
  AVATAR_MAX_PIXELS,
  AVATAR_OUTPUT_SIZE,
  avatarError,
} from './avatar.constants';

/** Strict raster containers, bounded decoding, no metadata copied to the output. */
@Injectable()
export class AvatarImageService {
  private active = 0;
  constructor() {
    // Native libvips memory/threads also count towards the EC2 container limit.
    sharp.cache({ memory: 16, files: 0, items: 20 });
    sharp.concurrency(1);
  }

  async normalize(body: Buffer, contentType: string): Promise<Buffer> {
    if (!body.length || body.length > AVATAR_MAX_BYTES)
      throw avatarError(
        413,
        'AVATAR_TOO_LARGE',
        'Choose a photo no larger than 5 MiB.',
      );
    const format = this.format(body);
    if (contentType !== `image/${format === 'jpeg' ? 'jpeg' : format}`)
      throw avatarError(
        415,
        'AVATAR_MIME_MISMATCH',
        'Photo contents do not match its image type.',
      );
    if (this.active >= 2)
      throw avatarError(
        503,
        'AVATAR_PROCESSOR_BUSY',
        'Photo processing is busy. Try again shortly.',
      );
    this.active++;
    try {
      const image = sharp(body, {
        failOn: 'warning',
        limitInputPixels: AVATAR_MAX_PIXELS,
        sequentialRead: true,
      }).timeout({ seconds: 5 });
      const metadata = await image.metadata();
      if (metadata.format !== format || (metadata.pages ?? 1) !== 1)
        throw avatarError(
          415,
          'AVATAR_UNSUPPORTED_IMAGE',
          'Use a non-animated JPEG, PNG or WebP photo.',
        );
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width < 16 ||
        metadata.height < 16 ||
        metadata.width > 8192 ||
        metadata.height > 8192 ||
        metadata.width * metadata.height > AVATAR_MAX_PIXELS
      )
        throw avatarError(
          422,
          'AVATAR_INVALID_DIMENSIONS',
          'Photo dimensions must be 16–8192 pixels and at most 16 megapixels.',
        );
      const side = Math.min(
        metadata.width,
        metadata.height,
        AVATAR_OUTPUT_SIZE,
      );
      return await image
        .rotate()
        .resize(side, side, {
          fit: 'cover',
          withoutEnlargement: true,
        })
        .toColourspace('srgb')
        .webp({ quality: 85, effort: 4 })
        .toBuffer();
    } catch (error) {
      if (error instanceof Error && 'getStatus' in error) throw error;
      throw avatarError(
        415,
        'AVATAR_INVALID_IMAGE',
        'This photo could not be decoded safely.',
      );
    } finally {
      this.active--;
    }
  }

  private format(body: Buffer): 'jpeg' | 'png' | 'webp' {
    if (
      body.length >= 4 &&
      body[0] === 0xff &&
      body[1] === 0xd8 &&
      body[2] === 0xff
    ) {
      if (body[body.length - 2] !== 0xff || body[body.length - 1] !== 0xd9)
        throw avatarError(415, 'AVATAR_INVALID_IMAGE', 'Invalid JPEG framing.');
      return 'jpeg';
    }
    if (
      body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      let offset = 8;
      while (offset + 12 <= body.length) {
        const size = body.readUInt32BE(offset);
        const type = body.toString('ascii', offset + 4, offset + 8);
        if (size > body.length - offset - 12 || type === 'acTL')
          throw avatarError(
            415,
            'AVATAR_UNSUPPORTED_IMAGE',
            'Use a complete, non-animated PNG.',
          );
        offset += size + 12;
        if (type === 'IEND') {
          if (size === 0 && offset === body.length) return 'png';
          break;
        }
      }
      throw avatarError(415, 'AVATAR_INVALID_IMAGE', 'Invalid PNG framing.');
    }
    if (
      body.toString('ascii', 0, 4) === 'RIFF' &&
      body.toString('ascii', 8, 12) === 'WEBP' &&
      body.length >= 20
    ) {
      if (body.readUInt32LE(4) + 8 !== body.length)
        throw avatarError(415, 'AVATAR_INVALID_IMAGE', 'Invalid WebP framing.');
      let offset = 12;
      while (offset + 8 <= body.length) {
        const type = body.toString('ascii', offset, offset + 4);
        const size = body.readUInt32LE(offset + 4);
        if (['ANIM', 'ANMF'].includes(type))
          throw avatarError(
            415,
            'AVATAR_UNSUPPORTED_IMAGE',
            'Animated photos are not supported.',
          );
        if (size > body.length - offset - 8) break;
        offset += 8 + size + (size % 2);
      }
      if (offset === body.length) return 'webp';
    }
    throw avatarError(
      415,
      'AVATAR_UNSUPPORTED_IMAGE',
      'Choose a JPEG, PNG or WebP photo.',
    );
  }
}
