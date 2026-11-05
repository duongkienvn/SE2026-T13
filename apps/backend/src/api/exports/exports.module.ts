import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { AuthModule } from '../auth/auth.module';
import { ExportsController } from './exports.controller';
import { BoardExportService } from './board-export.service';
import { AccountExportService } from './account-export.service';
import { ExportSnapshot } from './export-snapshot';

/** Run before authentication and validation, so failed downloads are never cached. */
export function exportPrivacyHeaders(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}
@Module({
  imports: [AuthModule],
  controllers: [ExportsController],
  providers: [BoardExportService, AccountExportService, ExportSnapshot],
})
export class ExportsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(exportPrivacyHeaders)
      .forRoutes(
        { path: 'boards/:boardId/export', method: RequestMethod.GET },
        { path: 'users/me/export', method: RequestMethod.GET },
      );
  }
}
