import { IsNull, type DataSource } from 'typeorm';
import { User } from './entities/user.entity';

/** Final dispatch fence, outside locks. Already-started provider requests cannot be recalled. */
export function canDeliverToAccount(
  source: DataSource,
  userId: string,
  email: string,
): Promise<boolean> {
  return source
    .getRepository(User)
    .existsBy({ id: userId, email, deletedAt: IsNull() });
}
