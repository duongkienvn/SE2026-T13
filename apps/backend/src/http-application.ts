import {
  ClassSerializerInterceptor,
  INestApplication,
  RequestMethod,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { EnvironmentConfig } from './config/environment';
import { createValidationPipe } from './config/validation';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { ApiResponseInterceptor } from './interceptors/api-response.interceptor';

export function configureHttpApplication(app: INestApplication): void {
  const config = app.get<ConfigService<EnvironmentConfig, true>>(ConfigService);
  const swaggerEnabled = config.get('SWAGGER_ENABLED', { infer: true });
  app.use(
    helmet({
      contentSecurityPolicy: swaggerEnabled
        ? {
            directives: {
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
            },
          }
        : undefined,
    }),
  );
  const allowedOrigins = config.get('CORS_ORIGINS', { infer: true });
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allowed?: boolean) => void,
    ) => callback(null, !origin || allowedOrigins.includes(origin)),
  });
  app.setGlobalPrefix(config.get('API_PREFIX', { infer: true }), {
    exclude: [
      { path: '/', method: RequestMethod.GET },
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter(app.get(Logger)));
  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(reflector),
    new ApiResponseInterceptor(reflector),
  );
  app.enableShutdownHooks();

  if (swaggerEnabled) {
    const documentConfig = new DocumentBuilder()
      .setTitle('Realtime Collaborative Kanban')
      .setDescription('REST API for the collaborative Kanban backend')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, documentConfig);
    SwaggerModule.setup('api-docs', app, document, { useGlobalPrefix: false });
  }
}
