import { isIP } from 'node:net';

export interface AttachmentEnvironment {
  ATTACHMENT_STORAGE_DRIVER: 'disabled' | 'memory' | 's3';
  ATTACHMENT_S3_BUCKET: string;
  ATTACHMENT_S3_REGION: string;
  ATTACHMENT_S3_PREFIX: string;
  ATTACHMENT_POLICY_ACK: '' | 'v1';
}

/** No endpoints/static credentials. Tests cannot inherit a live S3 driver. */
export function validateAttachmentEnvironment(
  input: Record<string, unknown>,
): AttachmentEnvironment {
  const requested = String(input.ATTACHMENT_STORAGE_DRIVER ?? 'disabled');
  if (!['disabled', 'memory', 's3'].includes(requested))
    throw new Error('ATTACHMENT_STORAGE_DRIVER must be disabled, memory or s3');
  if (input.NODE_ENV === 'production' && requested === 'memory')
    throw new Error('Memory attachment storage is forbidden in production');
  const driver =
    input.NODE_ENV === 'test' && requested === 's3'
      ? 'disabled'
      : (requested as AttachmentEnvironment['ATTACHMENT_STORAGE_DRIVER']);
  const bucket = String(input.ATTACHMENT_S3_BUCKET ?? '');
  const region = String(input.ATTACHMENT_S3_REGION ?? 'ap-southeast-1');
  const prefix = String(input.ATTACHMENT_S3_PREFIX ?? 'attachments/v1');
  const ack = String(input.ATTACHMENT_POLICY_ACK ?? '');
  if (ack !== '' && ack !== 'v1')
    throw new Error('ATTACHMENT_POLICY_ACK must be empty or v1');
  if (!/^[a-z]{2}-[a-z-]+-\d$/.test(region))
    throw new Error('ATTACHMENT_S3_REGION is invalid');
  if (
    !/^[a-z0-9][a-z0-9/-]{0,62}[a-z0-9]$/.test(prefix) ||
    prefix.includes('//') ||
    prefix.startsWith('avatars/')
  )
    throw new Error('ATTACHMENT_S3_PREFIX must be a safe isolated key prefix');
  if (driver === 's3') {
    if (
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
      bucket.includes('..') ||
      isIP(bucket)
    )
      throw new Error(
        'ATTACHMENT_S3_BUCKET is required and must be a valid bucket name',
      );
    if (bucket === input.AVATAR_S3_BUCKET)
      throw new Error('Attachment and avatar buckets must be separate');
    if (ack !== 'v1')
      throw new Error(
        'Review the V1 file policy and set ATTACHMENT_POLICY_ACK=v1 before S3 enablement',
      );
  }
  for (const name of [
    'ATTACHMENT_ACCESS_KEY_ID',
    'ATTACHMENT_SECRET_ACCESS_KEY',
    'ATTACHMENT_S3_ENDPOINT',
  ])
    if (input[name])
      throw new Error(
        `${name} is unsupported; use the IAM role and private AWS S3`,
      );
  return {
    ATTACHMENT_STORAGE_DRIVER: driver,
    ATTACHMENT_S3_BUCKET: bucket,
    ATTACHMENT_S3_REGION: region,
    ATTACHMENT_S3_PREFIX: prefix,
    ATTACHMENT_POLICY_ACK: ack as '' | 'v1',
  };
}
