import { ApplicationException } from '../../../exceptions/application.exception';

export const ATTACHMENT_URL_MAX_LENGTH = 2048;
export const ATTACHMENT_NAME_MAX_LENGTH = 120;

export function attachmentValidation(message: string): never {
  throw new ApplicationException(400, 'VALIDATION_FAILED', message);
}

/** Syntax only. Never performs DNS, HTTP, redirects, previews or other target I/O. */
export function normalizeAttachmentUrl(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > ATTACHMENT_URL_MAX_LENGTH ||
    !/^https:\/\//i.test(value) ||
    /[\s\x00-\x1f\x7f\\]/u.test(value) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)
  )
    attachmentValidation(
      'Expected an HTTPS URL without credentials or control characters',
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return attachmentValidation('Expected a valid HTTPS URL');
  }
  const authority = value.slice(value.indexOf('//') + 2).split(/[/?#]/, 1)[0];
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    authority.includes('@') ||
    url.href.length > ATTACHMENT_URL_MAX_LENGTH
  )
    attachmentValidation('Expected an HTTPS URL without credentials');
  return url.href;
}

export function isAttachmentUrl(value: unknown): boolean {
  try {
    normalizeAttachmentUrl(value);
    return true;
  } catch {
    return false;
  }
}

export function attachmentDisplayName(value: unknown, url: string): string {
  if (value === undefined)
    return new URL(url).hostname.slice(0, ATTACHMENT_NAME_MAX_LENGTH);
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > ATTACHMENT_NAME_MAX_LENGTH ||
    /[\x00-\x1f\x7f]/u.test(value)
  )
    attachmentValidation('Expected a display name of 1 to 120 characters');
  return value.trim();
}
