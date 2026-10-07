import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolve } from 'node:path';
import { HealthController } from './api/health/health.controller';
import { HealthService } from './api/health/health.service';
import { databaseOptions } from './database/database-options';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(process.cwd(), '../../.env'),
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () => databaseOptions(process.env),
    }),
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
