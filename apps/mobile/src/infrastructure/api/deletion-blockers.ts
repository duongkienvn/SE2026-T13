import type {
  AccountDeletionBlocker,
  AccountDeletionBlockerType,
} from '@kanban/shared';
import { parseResourceId } from '../../navigation/routes.ts';
const types: readonly AccountDeletionBlockerType[] = [
  'PERSONAL_WORKSPACE_HAS_BOARDS',
  'BOARD_REQUIRES_ANOTHER_OWNER',
  'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN',
];
/** Reject the entire malformed projection. Never pass arbitrary error data to UI. */
export function deletionBlockers(value: unknown): AccountDeletionBlocker[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return [];
  const seen = new Set<string>(),
    result: AccountDeletionBlocker[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const { type, totalCount, resources } = entry;
    if (
      !types.includes(type) ||
      seen.has(type) ||
      !Number.isSafeInteger(totalCount) ||
      totalCount < 1 ||
      !Array.isArray(resources) ||
      resources.length > 20 ||
      resources.length > totalCount
    )
      return [];
    seen.add(type);
    const ids = new Set<string>(),
      safe: AccountDeletionBlocker['resources'] = [];
    for (const row of resources) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
      const id = typeof row.id === 'string' ? parseResourceId(row.id) : null;
      if (
        !id ||
        ids.has(id) ||
        typeof row.name !== 'string' ||
        !row.name.trim() ||
        row.name.length > 300 ||
        /[\p{Cc}\p{Cf}]/u.test(row.name)
      )
        return [];
      ids.add(id);
      safe.push({ id, name: row.name });
    }
    result.push({ type, totalCount, resources: safe });
  }
  return result;
}
