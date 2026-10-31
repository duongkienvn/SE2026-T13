import { extname } from 'node:path';
import { ApplicationException } from '../../../exceptions/application.exception';
import { ATTACHMENT_FILE_POLICY_PROPOSAL } from './attachment-policy';

/** Enforced V1 implementation policy; S3 requires explicit operator acknowledgement. */
export const ATTACHMENT_FILE_POLICY = Object.freeze({
  version: 'v1',
  maximumFileBytes: 10 * 1024 * 1024,
  maximumBoardFileBytes: 100 * 1024 * 1024,
  maximumCardAttachments: 20,
  intentMilliseconds: 15 * 60_000,
  postSeconds: 60,
  verificationMilliseconds: 120_000,
  cleanupGraceMilliseconds: 60 * 60_000,
  cleanupIntervalMilliseconds: 5 * 60_000,
  reconciliationMilliseconds: 24 * 60 * 60_000,
  maximumImagePixels: 16_000_000,
  maximumImageDimension: 8192,
  maximumCompletions: 2,
  allowedTypes: ATTACHMENT_FILE_POLICY_PROPOSAL.allowedTypes,
});
export type AttachmentMime = keyof typeof ATTACHMENT_FILE_POLICY.allowedTypes;
export function fileError(
  status: number,
  code: string,
  message: string,
): ApplicationException {
  return new ApplicationException(status, code, message);
}

export function safeAttachmentFilename(value: unknown): string {
  if (typeof value !== 'string' || value.length > 255)
    throw fileError(400, 'VALIDATION_FAILED', 'Invalid attachment filename');
  const name = value.normalize('NFKC');
  if (/[\p{Cc}\p{Cf}/\\]/u.test(name))
    throw fileError(
      400,
      'VALIDATION_FAILED',
      'Filename must not contain paths or control characters',
    );
  const sanitized = name
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!sanitized || sanitized.length > 255)
    throw fileError(400, 'VALIDATION_FAILED', 'Invalid attachment filename');
  return sanitized;
}
export function validateAttachmentDeclaration(
  filename: unknown,
  mime: unknown,
  size: unknown,
): {
  filename: string;
  mime: AttachmentMime;
  size: number;
  reservedBytes: number;
} {
  const name = safeAttachmentFilename(filename);
  if (
    typeof mime !== 'string' ||
    !Object.hasOwn(ATTACHMENT_FILE_POLICY.allowedTypes, mime)
  )
    throw fileError(
      415,
      'ATTACHMENT_TYPE_UNSUPPORTED',
      'Unsupported attachment type',
    );
  const type = mime as AttachmentMime;
  if (
    !(ATTACHMENT_FILE_POLICY.allowedTypes[type] as readonly string[]).includes(
      extname(name).toLowerCase(),
    )
  )
    throw fileError(
      415,
      'ATTACHMENT_TYPE_MISMATCH',
      'Filename extension does not match the declared type',
    );
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1)
    throw fileError(
      400,
      'VALIDATION_FAILED',
      'Expected an exact positive file size',
    );
  if (size > ATTACHMENT_FILE_POLICY.maximumFileBytes)
    throw fileError(413, 'ATTACHMENT_TOO_LARGE', 'Attachment exceeds 10 MiB');
  // Raster normalization may expand bytes. Reserve its bounded worst case up front.
  return {
    filename: name,
    mime: type,
    size,
    reservedBytes: type.startsWith('image/')
      ? ATTACHMENT_FILE_POLICY.maximumFileBytes
      : size,
  };
}
export function attachmentDisposition(filename: string, mime: string): string {
  const safe = safeAttachmentFilename(filename);
  const fallback = safe.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${mime.startsWith('image/') ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
