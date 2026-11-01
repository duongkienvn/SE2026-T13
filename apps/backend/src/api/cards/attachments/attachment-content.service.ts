import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import {
  ATTACHMENT_FILE_POLICY as POLICY,
  fileError,
  type AttachmentMime,
} from './attachment-file-policy';
import { verifyAttachmentPdf } from './attachment-pdf';

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(body: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Strict framing plus full bounded decode/re-encode; no metadata copied. */
@Injectable()
export class AttachmentContentService {
  private active = 0;
  constructor() {
    sharp.cache({ memory: 16, files: 0, items: 20 });
    sharp.concurrency(1);
  }
  async verify(
    body: Buffer,
    mime: AttachmentMime,
    reservedBytes: number,
  ): Promise<Buffer> {
    if (!body.length || body.length > POLICY.maximumFileBytes)
      throw fileError(413, 'ATTACHMENT_TOO_LARGE', 'Attachment exceeds 10 MiB');
    if (mime === 'text/plain') {
      this.text(body);
      return body;
    }
    if (mime === 'application/pdf') {
      verifyAttachmentPdf(body);
      return body;
    }
    const format = this.rasterFrame(body);
    if (`image/${format}` !== mime)
      throw fileError(
        415,
        'ATTACHMENT_TYPE_MISMATCH',
        'Content does not match the declared type',
      );
    if (this.active >= POLICY.maximumCompletions)
      throw fileError(
        503,
        'ATTACHMENT_PROCESSOR_BUSY',
        'Attachment processing is busy',
      );
    this.active++;
    try {
      const image = sharp(body, {
        failOn: 'warning',
        limitInputPixels: POLICY.maximumImagePixels,
        sequentialRead: true,
      }).timeout({ seconds: 5 });
      const meta = await image.metadata();
      if (
        meta.format !== format ||
        (meta.pages ?? 1) !== 1 ||
        !meta.width ||
        !meta.height ||
        meta.width > POLICY.maximumImageDimension ||
        meta.height > POLICY.maximumImageDimension ||
        meta.width * meta.height > POLICY.maximumImagePixels
      )
        throw fileError(
          422,
          'ATTACHMENT_IMAGE_INVALID',
          'Image dimensions or animation are unsupported',
        );
      const rotated = image.rotate().toColourspace('srgb');
      const output = await (
        format === 'png'
          ? rotated.png({ compressionLevel: 9 })
          : format === 'jpeg'
            ? rotated.jpeg({ quality: 90 })
            : rotated.webp({ quality: 90, effort: 4 })
      ).toBuffer();
      if (
        output.length > reservedBytes ||
        output.length > POLICY.maximumFileBytes
      )
        throw fileError(
          413,
          'ATTACHMENT_TOO_LARGE',
          'Verified image exceeds its reserved byte budget',
        );
      return output;
    } catch (error) {
      if (error instanceof Error && 'getStatus' in error) throw error;
      throw fileError(
        422,
        'ATTACHMENT_IMAGE_INVALID',
        'Image could not be decoded safely',
      );
    } finally {
      this.active--;
    }
  }
  private text(body: Buffer) {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch {
      throw fileError(
        415,
        'ATTACHMENT_TEXT_INVALID',
        'Text must use valid UTF-8',
      );
    }
    for (const char of text)
      if (/\p{Cc}/u.test(char) && !['\n', '\r', '\t'].includes(char))
        throw fileError(
          415,
          'ATTACHMENT_TEXT_INVALID',
          'Binary/control bytes are not plain text',
        );
    if (
      /<\s*(?:!doctype\s+html|html|script|svg|iframe|object|embed)\b|^\s*(?:#!|<\?xml|%PDF-|MZ)|\b(?:javascript:|eval\s*\(|alert\s*\()/im.test(
        text,
      )
    )
      throw fileError(
        415,
        'ATTACHMENT_TEXT_INVALID',
        'Active content is unsupported as plain text',
      );
  }
  private rasterFrame(body: Buffer): 'png' | 'jpeg' | 'webp' {
    const invalid = (): never => {
      throw fileError(
        415,
        'ATTACHMENT_IMAGE_INVALID',
        'Invalid or unsupported raster container',
      );
    };
    if (
      body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      let offset = 8,
        chunks = 0,
        data = false;
      while (offset + 12 <= body.length) {
        const size = body.readUInt32BE(offset),
          type = body.toString('ascii', offset + 4, offset + 8);
        if (
          size > body.length - offset - 12 ||
          type === 'acTL' ||
          !/^[A-Za-z]{4}$/.test(type)
        )
          return invalid();
        if (
          crc32(body.subarray(offset + 4, offset + 8 + size)) !==
          body.readUInt32BE(offset + 8 + size)
        )
          return invalid();
        if (chunks++ === 0 && (type !== 'IHDR' || size !== 13))
          return invalid();
        if (type === 'IDAT') data = true;
        offset += size + 12;
        if (type === 'IEND')
          return size === 0 && offset === body.length && data
            ? 'png'
            : invalid();
      }
      return invalid();
    }
    if (body[0] === 0xff && body[1] === 0xd8) {
      let offset = 2;
      while (offset < body.length) {
        if (body[offset++] !== 0xff) return invalid();
        while (body[offset] === 0xff) offset++;
        const marker = body[offset++];
        if (marker === 0xd9) return offset === body.length ? 'jpeg' : invalid();
        if (marker === 0xd8 || marker === 0 || offset + 2 > body.length)
          return invalid();
        const length = body.readUInt16BE(offset);
        if (length < 2 || length > body.length - offset) return invalid();
        offset += length;
        if (marker === 0xda) {
          while (offset < body.length) {
            if (body[offset] !== 0xff) {
              offset++;
              continue;
            }
            const next = body[offset + 1];
            if (next === 0 || (next >= 0xd0 && next <= 0xd7)) {
              offset += 2;
              continue;
            }
            break;
          }
        }
      }
      return invalid();
    }
    if (
      body.length >= 20 &&
      body.toString('ascii', 0, 4) === 'RIFF' &&
      body.toString('ascii', 8, 12) === 'WEBP'
    ) {
      if (body.readUInt32LE(4) + 8 !== body.length) return invalid();
      let offset = 12,
        frame = false;
      while (offset + 8 <= body.length) {
        const type = body.toString('ascii', offset, offset + 4),
          size = body.readUInt32LE(offset + 4);
        if (['ANIM', 'ANMF'].includes(type) || size > body.length - offset - 8)
          return invalid();
        if (['VP8 ', 'VP8L'].includes(type)) frame = true;
        offset += 8 + size + (size % 2);
      }
      if (offset === body.length && frame) return 'webp';
    }
    return invalid();
  }
}
