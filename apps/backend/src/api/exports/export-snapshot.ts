import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  ObjectLiteral,
  SelectQueryBuilder,
} from 'typeorm';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { BoardMember } from '../board-members/entities/board-member.entity';
import { User } from '../users/entities/user.entity';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { ApplicationException } from '../../exceptions/application.exception';

export const EXPORT_PAGE_SIZE = 100;
const SNAPSHOT_MS = 15_000;
export function snapshotAuthorization(
  manager: EntityManager,
): BoardAuthorizationService {
  return new BoardAuthorizationService(manager.getRepository(BoardMember));
}
/** All callers supply server-owned SQL selections, predicates and ordering. */
export async function* exportPages<T>(
  builder: SelectQueryBuilder<ObjectLiteral>,
): AsyncGenerator<T[]> {
  const deadline = Date.now() + SNAPSHOT_MS;
  for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
    if (Date.now() > deadline)
      throw new ApplicationException(503, 'EXPORT_TIMEOUT', 'Export timed out');
    const page = await builder
      .clone()
      .offset(offset)
      .limit(EXPORT_PAGE_SIZE)
      .getRawMany<T>();
    if (page.length) yield page;
    if (page.length < EXPORT_PAGE_SIZE) return;
  }
}
@Injectable()
export class ExportSnapshot {
  constructor(private readonly source: DataSource) {}
  read<T>(read: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      await manager.query("SET LOCAL statement_timeout = '5s'");
      await manager.query(
        "SET LOCAL idle_in_transaction_session_timeout = '20s'",
      );
      const deadline = Date.now() + SNAPSHOT_MS;
      const result = await read(manager);
      if (Date.now() > deadline)
        throw new ApplicationException(
          503,
          'EXPORT_TIMEOUT',
          'Export timed out',
        );
      return result;
    });
  }
  async requireSession(
    user: AuthenticatedUser,
    manager: EntityManager,
  ): Promise<void> {
    const valid =
      user.expiresAt > Date.now() &&
      (await manager.getRepository(User).exists({
        where: { id: user.userId, authVersion: user.authVersion },
      }));
    const profile = valid
      ? await manager.getRepository(User).findOne({
          select: { id: true, emailVerifiedAt: true },
          where: { id: user.userId },
        })
      : null;
    if (!profile?.emailVerifiedAt || user.expiresAt <= Date.now())
      throw new ApplicationException(401, 'UNAUTHORIZED', 'Unauthorized');
  }
}
