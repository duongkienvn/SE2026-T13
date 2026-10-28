import { QueryFailedError, type EntityManager } from 'typeorm';

/** Keep counts/page data consistent; retry when a locked grant changes mid-read. */
export async function readWorkspaceSnapshot<T>(
  manager: EntityManager,
  read: (transaction: EntityManager) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await manager.transaction('REPEATABLE READ', read);
    } catch (error) {
      if (
        attempt < 2 &&
        error instanceof QueryFailedError &&
        (error.driverError.code === '40001' ||
          error.driverError.code === '40P01')
      )
        continue;
      throw error;
    }
  }
}
