import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { EnvironmentConfig } from '../config/environment';
import {
  FakeVerificationMailer,
  VerificationMailer,
} from './verification-mailer';
import { ResendVerificationMailer } from './resend-verification-mailer';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: VerificationMailer,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentConfig, true>,
      ): VerificationMailer => {
        if (config.get('MAIL_TRANSPORT', { infer: true }) === 'fake')
          return new FakeVerificationMailer();
        return new ResendVerificationMailer(
          new Resend(config.get('RESEND_API_KEY', { infer: true })),
          config.get('MAIL_FROM', { infer: true }),
        );
      },
    },
  ],
  exports: [VerificationMailer],
})
export class MailModule {}
