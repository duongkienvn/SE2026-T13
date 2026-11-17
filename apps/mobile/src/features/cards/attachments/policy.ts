import { ApiError } from '../../../infrastructure/api/errors.ts';

/** V1 UX checks mirror the server; full decode/normalization remains server-owned. */
export const FILE_LIMIT = 10 * 1024 * 1024;
export const CARD_LIMIT = 20;
export const BOARD_LIMIT = 100 * 1024 * 1024;
export const FILE_TYPES = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
} as const;
export type FileMime = keyof typeof FILE_TYPES;

export function rejectFile(message: string): never {
  throw new ApiError('http', {
    status: 400,
    code: 'INVALID_ATTACHMENT',
    message,
  });
}
export function httpsUrl(value: string): string {
  const text = value.trim();
  if (
    text.length > 2048 ||
    !/^https:\/\//i.test(text) ||
    /[\s\\]/u.test(text) ||
    /\p{Cc}/u.test(value) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(text)
  )
    return rejectFile(
      'Enter an HTTPS URL without credentials or control characters.',
    );
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return rejectFile('Enter a valid HTTPS URL.');
  }
  const authority = text.slice(text.indexOf('//') + 2).split(/[/?#]/, 1)[0];
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    authority.includes('@') ||
    url.href.length > 2048
  )
    return rejectFile('Enter an HTTPS URL without credentials.');
  return url.href;
}
export function displayName(value: string) {
  const name = value.trim();
  if (!name || name.length > 120 || /\p{Cc}/u.test(value))
    return rejectFile('Enter a display name of 1–120 characters.');
  return name;
}
export function safeFilename(value: string) {
  const name = value.normalize('NFKC');
  if (name.length > 255 || /[\p{Cc}\p{Cf}/\\]/u.test(name))
    return rejectFile(
      'The filename contains a path or unsupported characters.',
    );
  const safe = name.replace(/[<>:"|?*]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  if (!safe || safe.length > 255)
    return rejectFile('Choose a file with a valid filename.');
  return safe;
}
export function isFileMime(value: unknown): value is FileMime {
  return typeof value === 'string' && Object.hasOwn(FILE_TYPES, value);
}
export function fileDeclaration(name: string, mime: string, size: number) {
  const filename = safeFilename(name);
  if (!isFileMime(mime))
    return rejectFile('Choose a PNG, JPEG, WebP, PDF or TXT file.');
  const extension = /\.[^.]+$/.exec(filename)?.[0].toLowerCase();
  if (!(FILE_TYPES[mime] as readonly string[]).includes(extension ?? ''))
    return rejectFile('The filename extension does not match the file type.');
  if (!Number.isSafeInteger(size) || size < 1 || size > FILE_LIMIT)
    return rejectFile('Choose a nonempty file no larger than 10 MiB.');
  return { filename, contentType: mime, fileSize: size };
}
function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}
function dimensions(width: number, height: number) {
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 16_000_000
  )
    rejectFile(
      'Images must be at most 16 megapixels and 8192 pixels per side.',
    );
}
/** Inspect real bytes, never just picker MIME/name. This is not a substitute for server verification. */
export function inspectBytes(bytes: Uint8Array, mime: FileMime) {
  if (!bytes.length || bytes.length > FILE_LIMIT)
    rejectFile('File exceeds the 10 MiB limit or is empty.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mismatch = () =>
    rejectFile('The file content does not match its declared type.');
  if (mime === 'text/plain') {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return mismatch();
    }
    for (const char of text) {
      if (
        /\p{Cc}/u.test(char) &&
        char !== '\n' &&
        char !== '\r' &&
        char !== '\t'
      )
        mismatch();
    }
    if (
      /<\s*(?:!doctype\s+html|html|script|svg|iframe|object|embed)\b|^\s*(?:#!|<\?xml|%PDF-|MZ)|\b(?:javascript:|eval\s*\(|alert\s*\()/im.test(
        text,
      )
    )
      mismatch();
    // A mislabeled API error must not become a shareable TXT download.
    try {
      const json: unknown = JSON.parse(text);
      if (
        json &&
        typeof json === 'object' &&
        ('success' in json || 'statusCode' in json || 'error' in json)
      )
        mismatch();
    } catch (error) {
      if (error instanceof ApiError) throw error;
    }
    return;
  }
  if (mime === 'application/pdf') {
    if (
      !/^%PDF-1\.[0-9]/.test(ascii(bytes, 0, 8)) ||
      !/%%EOF\s*$/.test(
        ascii(bytes, Math.max(0, bytes.length - 1024), bytes.length),
      )
    )
      mismatch();
    return;
  }
  if (mime === 'image/png') {
    if (
      bytes.length < 33 ||
      ascii(bytes, 0, 8) !== '\x89PNG\r\n\x1a\n' ||
      ascii(bytes, 12, 16) !== 'IHDR'
    )
      return mismatch();
    dimensions(view.getUint32(16), view.getUint32(20));
    return;
  }
  if (mime === 'image/jpeg') {
    if (
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes.at(-2) !== 255 ||
      bytes.at(-1) !== 217
    )
      return mismatch();
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) return mismatch();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (offset + 2 > bytes.length) return mismatch();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return mismatch();
      if ([192, 193, 194].includes(marker)) {
        if (length < 8) return mismatch();
        dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
        return;
      }
      offset += length;
    }
    return mismatch();
  }
  if (
    bytes.length < 30 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 12) !== 'WEBP' ||
    view.getUint32(4, true) + 8 !== bytes.length
  )
    return mismatch();
  const frame = ascii(bytes, 12, 16);
  if (frame === 'VP8X') {
    if (bytes[20] & 2) return rejectFile('Animated images are unsupported.');
    const u24 = (i: number) =>
      bytes[i] + (bytes[i + 1] << 8) + (bytes[i + 2] << 16);
    dimensions(u24(24) + 1, u24(27) + 1);
  } else if (
    frame === 'VP8 ' &&
    bytes[23] === 157 &&
    bytes[24] === 1 &&
    bytes[25] === 42
  ) {
    dimensions(
      view.getUint16(26, true) & 0x3fff,
      view.getUint16(28, true) & 0x3fff,
    );
  } else if (frame === 'VP8L' && bytes[20] === 47) {
    const bits = view.getUint32(21, true);
    dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  } else mismatch();
}

export function attachmentError(error: unknown) {
  if (!(error instanceof ApiError))
    return 'The file operation failed. Check device storage and try again.';
  if (error.code === 'ATTACHMENT_REVISION_CONFLICT')
    return 'This attachment changed. Reload it and review before saving again.';
  if (error.code === 'ATTACHMENT_LIMIT_REACHED')
    return 'Attachment quota reached: 20 per card or 100 MiB per board. Images reserve 10 MiB.';
  if (error.code === 'ATTACHMENT_UPLOAD_EXPIRED')
    return 'The upload expired. Cancel it, then select the file again.';
  if (error.code === 'ATTACHMENT_TRANSFER_EXPIRED')
    return 'The transfer grant expired. Retry upload to request a fresh grant.';
  if (error.status === 413) return 'The file exceeds the 10 MiB limit.';
  if ([415, 422].includes(error.status))
    return 'The server rejected the file type or content. Choose a valid PNG, JPEG, WebP, PDF or TXT.';
  if (error.status === 429) return 'Too many requests. Wait before retrying.';
  if (error.status === 503)
    return 'Private file storage or verification is unavailable. Try again later.';
  if ([401, 403, 404].includes(error.status))
    return 'This attachment is unavailable or access changed.';
  if (error.kind === 'offline')
    return 'You’re offline. Reconnect before retrying.';
  if (['timeout', 'network'].includes(error.kind))
    return 'The result is uncertain. Retry this operation to check it safely.';
  if (error.kind === 'aborted') return 'The operation was canceled.';
  if (error.kind === 'session-changed')
    return 'Access changed. Reopen the card to continue.';
  if (error.kind === 'invalid-response')
    return 'The server returned invalid attachment data. Nothing was saved.';
  return error.message;
}
