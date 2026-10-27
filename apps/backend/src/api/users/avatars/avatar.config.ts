export interface AvatarEnvironment {
  AVATAR_STORAGE_DRIVER: 'disabled' | 'memory' | 's3';
  AVATAR_S3_BUCKET: string;
  AVATAR_S3_REGION: string;
  AVATAR_S3_PREFIX: string;
}

export function validateAvatarEnvironment(
  input: Record<string, unknown>,
): AvatarEnvironment {
  const requested = String(input.AVATAR_STORAGE_DRIVER ?? 'disabled');
  if (!['disabled', 'memory', 's3'].includes(requested))
    throw new Error('AVATAR_STORAGE_DRIVER must be disabled, memory or s3');
  if (input.NODE_ENV === 'production' && requested === 'memory')
    throw new Error('Memory avatar storage is forbidden in production');
  // An inherited development .env must never cause tests to contact AWS.
  const driver =
    input.NODE_ENV === 'test' && requested === 's3'
      ? 'disabled'
      : (requested as AvatarEnvironment['AVATAR_STORAGE_DRIVER']);
  const bucket = String(input.AVATAR_S3_BUCKET ?? '');
  const region = String(input.AVATAR_S3_REGION ?? 'ap-southeast-1');
  const prefix = String(input.AVATAR_S3_PREFIX ?? 'avatars/v1');
  if (
    !/^[a-z0-9][a-z0-9/-]{0,62}[a-z0-9]$/.test(prefix) ||
    prefix.includes('//')
  )
    throw new Error('AVATAR_S3_PREFIX must be a safe lowercase key prefix');
  if (!/^[a-z]{2}-[a-z-]+-\d$/.test(region))
    throw new Error('AVATAR_S3_REGION is invalid');
  if (
    driver === 's3' &&
    (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
      bucket.includes('..'))
  )
    throw new Error(
      'AVATAR_S3_BUCKET is required and must be a valid bucket name',
    );
  return {
    AVATAR_STORAGE_DRIVER: driver,
    AVATAR_S3_BUCKET: bucket,
    AVATAR_S3_REGION: region,
    AVATAR_S3_PREFIX: prefix,
  };
}
