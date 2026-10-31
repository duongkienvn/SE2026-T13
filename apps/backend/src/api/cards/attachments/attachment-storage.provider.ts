import type { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../../../config/environment';
import { validateAttachmentEnvironment } from './attachment.config';
import {
  AttachmentStorage,
  DisabledAttachmentStorage,
} from './attachment-storage';
import {
  MemoryAttachmentStorage,
  S3AttachmentStorage,
} from './attachment-storage-drivers';

export const attachmentStorageProvider: FactoryProvider<AttachmentStorage> = {
  provide: AttachmentStorage,
  inject: [ConfigService],
  useFactory: (config: ConfigService<EnvironmentConfig, true>) => {
    const env = validateAttachmentEnvironment({
      NODE_ENV: config.get('NODE_ENV', { infer: true }),
      ATTACHMENT_STORAGE_DRIVER: config.get('ATTACHMENT_STORAGE_DRIVER', {
        infer: true,
      }),
      ATTACHMENT_S3_BUCKET: config.get('ATTACHMENT_S3_BUCKET', { infer: true }),
      ATTACHMENT_S3_REGION: config.get('ATTACHMENT_S3_REGION', { infer: true }),
      ATTACHMENT_S3_PREFIX: config.get('ATTACHMENT_S3_PREFIX', { infer: true }),
      ATTACHMENT_POLICY_ACK: config.get('ATTACHMENT_POLICY_ACK', {
        infer: true,
      }),
      AVATAR_S3_BUCKET: config.get('AVATAR_S3_BUCKET', { infer: true }),
    });
    if (env.ATTACHMENT_STORAGE_DRIVER === 'memory')
      return new MemoryAttachmentStorage();
    if (env.ATTACHMENT_STORAGE_DRIVER === 's3')
      return new S3AttachmentStorage(env);
    return new DisabledAttachmentStorage();
  },
};
