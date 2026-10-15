import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { resolve } from 'node:path';
import { HealthController } from './api/health/health.controller';
import { HealthService } from './api/health/health.service';
import { ReadinessService } from './api/health/readiness.service';
import { AuthModule } from './api/auth/auth.module';
import { UsersModule } from './api/users/users.module';
import { BoardsModule } from './api/boards/boards.module';
import { BoardMembersModule } from './api/board-members/board-members.module';
import { databaseOptions } from './database/database-options';
import { EnvironmentConfig, validateEnvironment } from './config/environment';
import { loggerOptions } from './logging/logger-options';
import { HttpThrottlerGuard } from './guards/http-throttler.guard';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(process.cwd(), '../../.env'),
      validate: validateEnvironment,
    }),
    AuthModule,
    UsersModule,
    BoardsModule,
    BoardMembersModule,
    RealtimeModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentConfig, true>) =>
        loggerOptions({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
        }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentConfig, true>) => [
        {
          ttl: config.get('RATE_LIMIT_TTL_MS', { infer: true }),
          limit: config.get('RATE_LIMIT_MAX', { infer: true }),
        },
      ],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentConfig, true>) =>
        databaseOptions({
          DATABASE_HOST: config.get('DATABASE_HOST', { infer: true }),
          DATABASE_PORT: String(config.get('DATABASE_PORT', { infer: true })),
          DATABASE_NAME: config.get('DATABASE_NAME', { infer: true }),
          DATABASE_USER: config.get('DATABASE_USER', { infer: true }),
          DATABASE_PASSWORD: config.get('DATABASE_PASSWORD', { infer: true }),
          DATABASE_POOL_SIZE: String(
            config.get('DATABASE_POOL_SIZE', { infer: true }),
          ),
          DATABASE_CONNECT_TIMEOUT_MS: String(
            config.get('DATABASE_CONNECT_TIMEOUT_MS', { infer: true }),
          ),
          DATABASE_SSL: String(config.get('DATABASE_SSL', { infer: true })),
        }),
    }),
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    ReadinessService,
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
  ],
})
export class AppModule {}
