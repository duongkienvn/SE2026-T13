import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnvironmentConfig } from '../../../config/environment';
import { AuthModule } from '../../auth/auth.module';
import { BoardMember } from '../../board-members/entities/board-member.entity';
import { BoardMembersModule } from '../../board-members/board-members.module';
import { User } from '../entities/user.entity';
import { AvatarUpload } from '../entities/avatar-upload.entity';
import {
  AvatarController,
  AvatarMultipartErrors,
  LocalAvatarUploadGuard,
} from './avatar.controller';
import { AvatarImageService } from './avatar-image.service';
import { AvatarService } from './avatar.service';
import {
  AvatarStorage,
  DisabledAvatarStorage,
  MemoryAvatarStorage,
  S3AvatarStorage,
} from './avatar-storage';

@Module({
  imports: [
    AuthModule,
    BoardMembersModule,
    TypeOrmModule.forFeature([User, AvatarUpload, BoardMember]),
  ],
  controllers: [AvatarController],
  providers: [
    AvatarService,
    AvatarImageService,
    LocalAvatarUploadGuard,
    AvatarMultipartErrors,
    {
      provide: AvatarStorage,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentConfig, true>) => {
        const driver = config.get('AVATAR_STORAGE_DRIVER', { infer: true });
        if (driver === 'memory') return new MemoryAvatarStorage();
        if (driver !== 's3') return new DisabledAvatarStorage();
        return new S3AvatarStorage({
          AVATAR_STORAGE_DRIVER: driver,
          AVATAR_S3_BUCKET: config.get('AVATAR_S3_BUCKET', { infer: true }),
          AVATAR_S3_REGION: config.get('AVATAR_S3_REGION', { infer: true }),
          AVATAR_S3_PREFIX: config.get('AVATAR_S3_PREFIX', { infer: true }),
        });
      },
    },
  ],
  exports: [AvatarService, AvatarStorage],
})
export class AvatarModule {}
