/** RED-phase placeholder: the API contract tests must reject unimplemented board filtering. */
export function cardBoardScope(_boardId: string | undefined): {
  clause: string;
  params: { boardScopeId: string };
} | null {
  return null;
}
