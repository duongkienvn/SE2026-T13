import { BOARD, CARD } from '../realtime/integration-support.ts';
import { uuid } from '../workspaces/fixtures.ts';
export const comment = (n = 1) => ({
  id: uuid(n + 100),
  cardId: CARD,
  authorId: BOARD,
  content: `Comment ${n}\n😀 <script>plain text</script> https://example.test`,
  mentions: [],
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
});
