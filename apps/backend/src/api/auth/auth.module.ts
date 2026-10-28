import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { EnvironmentConfig } from '../../config/environment';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  JWT_AUDIENCE,
  JWT_EXPIRES_IN_SECONDS,
  JWT_ISSUER,
} from './constants/auth.constants';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MailModule } from '../../mail/mail.module';
import { EmailVerificationService } from './email-verification.service';
import { EmailVerificationToken } from './entities/email-verification-token.entity';
import { GoogleIdentity } from './entities/google-identity.entity';
import { GoogleTokenVerifier } from './google-token-verifier.service';
import { GoogleAuthService } from './google-auth.service';
import { GoogleAuthController } from './google-auth.controller';
import { PasswordSecurityService } from './password-security.service';
import { PasswordSecurityController } from './password-security.controller';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { WelcomeOnboardingService } from './welcome-onboarding.service';
import { WelcomeEmailDelivery } from './entities/welcome-email-delivery.entity';

@Module({
  imports: [
    ConfigModule,
    MailModule,
    WorkspacesModule,
    TypeOrmModule.forFeature([
      User,
      EmailVerificationToken,
      GoogleIdentity,
      PasswordResetToken,
      WelcomeEmailDelivery,
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentConfig, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256' as const,
          expiresIn: JWT_EXPIRES_IN_SECONDS,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
        verifyOptions: {
          algorithms: ['HS256'] as const,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
      }),
    }),
  ],
  controllers: [
    AuthController,
    GoogleAuthController,
    PasswordSecurityController,
  ],
  providers: [
    AuthService,
    PasswordSecurityService,
    JwtAuthGuard,
    EmailVerificationService,
    GoogleTokenVerifier,
    GoogleAuthService,
    WelcomeOnboardingService,
  ],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
