import { isUUID } from 'class-validator';

export interface PushEnvironment {
  PUSH_NOTIFICATIONS_ENABLED: boolean;
  PUSH_PROJECT_ID: string;
  PUSH_APP_ENVIRONMENT: 'development' | 'preview' | 'production';
  PUSH_TOKEN_ENCRYPTION_KEY: string;
  EXPO_PUSH_ACCESS_TOKEN: string;
}
export function validatePushEnvironment(
  input: Record<string, unknown>,
): PushEnvironment {
  const flag = input.PUSH_NOTIFICATIONS_ENABLED ?? false;
  if (![true, false, 'true', 'false', ''].includes(flag as string))
    throw new Error('PUSH_NOTIFICATIONS_ENABLED must be true or false');
  const enabled = flag === true || flag === 'true';
  const key =
    typeof input.PUSH_TOKEN_ENCRYPTION_KEY === 'string'
      ? input.PUSH_TOKEN_ENCRYPTION_KEY
      : '';
  const projectId =
    typeof input.PUSH_PROJECT_ID === 'string'
      ? input.PUSH_PROJECT_ID.toLowerCase()
      : '';
  const environment = input.PUSH_APP_ENVIRONMENT ?? 'development';
  const accessToken = input.EXPO_PUSH_ACCESS_TOKEN ?? '';
  if (enabled) {
    if (
      !/^[A-Za-z0-9+/]{43}=$/.test(key) ||
      Buffer.from(key, 'base64').length !== 32 ||
      Buffer.from(key, 'base64').toString('base64') !== key
    )
      throw new Error(
        'Invalid PUSH_TOKEN_ENCRYPTION_KEY: require 32 base64-encoded bytes',
      );
    if (!isUUID(projectId, '4')) throw new Error('Invalid PUSH_PROJECT_ID');
    if (!['development', 'preview', 'production'].includes(String(environment)))
      throw new Error('Invalid PUSH_APP_ENVIRONMENT');
    if (
      typeof accessToken !== 'string' ||
      (accessToken !== '' && !/^[\x21-\x7e]{10,1024}$/.test(accessToken))
    )
      throw new Error('Invalid EXPO_PUSH_ACCESS_TOKEN');
  }
  return {
    PUSH_NOTIFICATIONS_ENABLED: enabled,
    PUSH_PROJECT_ID: enabled ? projectId : '',
    PUSH_APP_ENVIRONMENT: enabled
      ? (environment as PushEnvironment['PUSH_APP_ENVIRONMENT'])
      : 'development',
    PUSH_TOKEN_ENCRYPTION_KEY: enabled ? key : '',
    EXPO_PUSH_ACCESS_TOKEN: enabled ? (accessToken as string) : '',
  };
}
