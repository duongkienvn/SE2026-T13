import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { resolve } from 'node:path';
import { HealthController } from './api/health/health.controller';
import { HealthService } from './api/health/health.service';
import { databaseOptions } from './database/database-options';
import { EnvironmentConfig, validateEnvironment } from './config/environment';
import { loggerOptions } from './logging/logger-options';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(process.cwd(), '../../.env'),
      validate: validateEnvironment,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentConfig, true>) =>
        loggerOptions({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
        }),
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
        }),
    }),
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
