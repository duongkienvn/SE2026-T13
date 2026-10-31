import { Repository } from 'typeorm';
import { CardChecklist } from './entities/card-checklist.entity';
import { CardChecklistItem } from './entities/card-checklist-item.entity';
import { cardInsertionPosition } from './cards-ordering';
import { rebalancePositions } from '../columns/columns-ordering';

/** Caller holds the Board lock. Deferred parent-position UNIQUE protects rebalance. */
export async function persistChecklistPosition<
  T extends CardChecklist | CardChecklistItem,
>(
  repository: Repository<T>,
  remaining: T[],
  moving: T,
  index: number,
): Promise<T> {
  const position = cardInsertionPosition(
    remaining[index - 1]?.position,
    remaining[index]?.position,
  );
  if (position) {
    moving.position = position;
    return repository.save(moving);
  }
  const ordered = [...remaining];
  ordered.splice(index, 0, moving);
  const positions = rebalancePositions(ordered.length);
  ordered.forEach((row, i) => {
    row.position = positions[i];
  });
  const saved = await repository.save(ordered);
  return saved[index];
}
