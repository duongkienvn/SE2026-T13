import type { ResourceId } from '../../navigation/routes.ts';
import type { WorkspaceSummary } from './decoder.ts';

export function resolveWorkspace(
  rows: readonly WorkspaceSummary[] | undefined,
  preferred: ResourceId | null,
  readable: (id: ResourceId) => boolean,
) {
  if (!rows) return null;
  return (
    rows.find((row) => row.id === preferred && readable(row.id)) ??
    rows.find((row) => readable(row.id)) ??
    null
  );
}
