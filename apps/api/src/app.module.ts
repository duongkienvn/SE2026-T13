import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolve } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
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
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
