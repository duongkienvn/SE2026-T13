/** A query-builder fragment, never composed from user text.
 * Authorization predicates are still mandatory in searchCards().
 */
export function cardBoardScope(boardId: string | undefined) {
  if (boardId === undefined) return null;
  return {
    clause: 'card.boardId = :boardScopeId',
    params: { boardScopeId: boardId },
  };
}
