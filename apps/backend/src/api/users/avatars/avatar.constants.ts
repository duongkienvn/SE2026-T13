import { HttpStatus } from '@nestjs/common';
import { ApplicationException } from '../../../exceptions/application.exception';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MAX_PIXELS = 16 * 1024 * 1024;
export const AVATAR_OUTPUT_SIZE = 512;
export const AVATAR_INTENT_MS = 5 * 60_000;
export const AVATAR_POST_SECONDS = 60;
export const AVATAR_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AvatarMime = (typeof AVATAR_MIMES)[number];

export function avatarError(
  status: HttpStatus,
  code: string,
  message: string,
): ApplicationException {
  return new ApplicationException(status, code, message);
}
