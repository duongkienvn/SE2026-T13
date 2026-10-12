import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { EnvironmentConfig } from './config/environment';
import { configureHttpApplication } from './http-application';

export async function createApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureHttpApplication(app);
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const config = app.get<ConfigService<EnvironmentConfig, true>>(ConfigService);
  await app.listen(config.get('API_PORT', { infer: true }));
}

if (require.main === module) {
  void bootstrap();
}
