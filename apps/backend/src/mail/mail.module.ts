import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  EmailChangeMailer,
  FakeEmailChangeMailer,
  ResendEmailChangeMailer,
} from './email-change-mailer';
import { EnvironmentConfig } from '../config/environment';
import {
  FakeVerificationMailer,
  VerificationMailer,
} from './verification-mailer';
import { ResendVerificationMailer } from './resend-verification-mailer';
import {
  PasswordRecoveryMailer,
  FakePasswordRecoveryMailer,
} from './password-recovery-mailer';
import { ResendPasswordRecoveryMailer } from './resend-password-recovery-mailer';
import { FakeWelcomeMailer, WelcomeMailer } from './welcome-mailer';
import { ResendWelcomeMailer } from './resend-welcome-mailer';
import { WorkspaceInvitationMailer } from '../api/workspaces/workspace-invitation-mailer';
import { FakeWorkspaceInvitationMailer } from './fake-workspace-invitation-mailer';
import { ResendWorkspaceInvitationMailer } from './resend-workspace-invitation-mailer';
import {
  BoardMemberAddedMailer,
  FakeBoardMemberAddedMailer,
} from './board-member-added-mailer';
import { ResendBoardMemberAddedMailer } from './resend-board-member-added-mailer';
import {
  FakeTaskNotificationMailer,
  ResendTaskNotificationMailer,
  TaskNotificationMailer,
} from './task-notification-mailer';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: EmailChangeMailer,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentConfig, true>,
      ): EmailChangeMailer => {
        const appUrl = config.get('PUBLIC_APP_URL', { infer: true });
        return config.get('MAIL_TRANSPORT', { infer: true }) === 'fake'
          ? new FakeEmailChangeMailer(appUrl)
          : new ResendEmailChangeMailer(
              new Resend(config.get('RESEND_API_KEY', { infer: true })),
              config.get('MAIL_FROM', { infer: true }),
              appUrl,
            );
      },
    },
    {
      provide: TaskNotificationMailer,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentConfig, true>,
      ): TaskNotificationMailer =>
        config.get('MAIL_TRANSPORT', { infer: true }) === 'fake'
          ? new FakeTaskNotificationMailer()
          : new ResendTaskNotificationMailer(
              new Resend(config.get('RESEND_API_KEY', { infer: true })),
              config.get('MAIL_FROM', { infer: true }),
              config.get('PUBLIC_APP_URL', { infer: true }),
            ),
    },
    {
      provide: BoardMemberAddedMailer,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentConfig, true>,
      ): BoardMemberAddedMailer => {
        const from = config.get('MAIL_FROM', { infer: true });
        const origin = config.get('PUBLIC_APP_URL', { infer: true });
        return config.get('MAIL_TRANSPORT', { infer: true }) === 'fake'
          ? new FakeBoardMemberAddedMailer(from, origin)
          : new ResendBoardMemberAddedMailer(
              new Resend(config.get('RESEND_API_KEY', { infer: true })),
              from,
              origin,
            );
      },
    },
    {
      provide: WorkspaceInvitationMailer,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentConfig, true>,
      ): WorkspaceInvitationMailer | undefined => {
        const path = config.get('WORKSPACE_INVITATION_ACCEPT_PATH', {
          infer: true,
        });
        // Preserve P2-03's UNAVAILABLE state until P2-08 has a working destination.
        if (!path) return undefined;
        const from = config.get('MAIL_FROM', { infer: true });
        const origin = config.get('PUBLIC_APP_URL', { infer: true });
        return config.get('MAIL_TRANSPORT', { infer: true }) === 'fake'
          ? new FakeWorkspaceInvitationMailer(from, origin, path)
          : new ResendWorkspaceInvitationMailer(
              new Resend(config.get('RESEND_API_KEY', { infer: true })),
              from,
              origin,
              path,
            );
      },
    },
    {
      provide: WelcomeMailer,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentConfig, true>,
      ): WelcomeMailer =>
        // Use the same validated transport as verification/recovery. Development
        // can explicitly opt into Resend; environment validation forces tests fake.
        config.get('MAIL_TRANSPORT', { infer: true }) === 'fake'
          ? new FakeWelcomeMailer()
          : new ResendWelcomeMailer(
              new Resend(config.get('RESEND_API_KEY', { infer: true })),
            ),
    },
    {
      provide: PasswordRecoveryMailer,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentConfig, true>,
      ): PasswordRecoveryMailer => {
        if (config.get('MAIL_TRANSPORT', { infer: true }) === 'fake')
          return new FakePasswordRecoveryMailer();
        return new ResendPasswordRecoveryMailer(
          new Resend(config.get('RESEND_API_KEY', { infer: true })),
          config.get('MAIL_FROM', { infer: true }),
        );
      },
    },
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
  exports: [
    EmailChangeMailer,
    TaskNotificationMailer,
    BoardMemberAddedMailer,
    VerificationMailer,
    PasswordRecoveryMailer,
    WelcomeMailer,
    WorkspaceInvitationMailer,
  ],
})
export class MailModule {}
