import type { EntityManager } from 'typeorm';

/** Static SQL inventory; never interpolate request input or return graph contents. */
const cards = 'SELECT id FROM cards WHERE board_id=$1';
const graph = [
  ['boards', 'id=$1'],
  ['board_members', 'board_id=$1'],
  ['board_columns', 'board_id=$1'],
  ['board_labels', 'board_id=$1'],
  ['cards', 'board_id=$1'],
  ['card_labels', 'board_id=$1'],
  ['card_assignees', `card_id IN (${cards})`],
  ['card_checklists', `card_id IN (${cards})`],
  [
    'card_checklist_items',
    `checklist_id IN (SELECT id FROM card_checklists WHERE card_id IN (${cards}))`,
  ],
  ['comments', `card_id IN (${cards})`],
  [
    'comment_mentions',
    `comment_id IN (SELECT id FROM comments WHERE card_id IN (${cards}))`,
  ],
  ['card_attachments', 'board_id=$1'],
  ['activities', 'board_id=$1'],
  ['workspace_activities', 'board_id=$1'],
] as const;

/** Caller holds the Board lock, shared with normal business mutations. */
export async function starterBoardSnapshot(
  manager: EntityManager,
  boardId: string,
): Promise<string> {
  const fields = graph
    .map(
      ([table, where]) =>
        `'${table}',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM ${table} t WHERE ${where})`,
    )
    .join(',');
  const [{ version }]: { version: string }[] = await manager.query(
    `SELECT encode(sha256(convert_to(jsonb_build_object(${fields})::text,'UTF8')),'hex') AS version`,
    [boardId],
  );
  return version;
}
