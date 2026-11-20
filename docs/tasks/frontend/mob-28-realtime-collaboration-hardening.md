# MOB-28 Native Board presence and collaboration hardening

[Issue #295](https://github.com/duongkienvn/SE2026-T13/issues/295)

Built on `main` after MOB-23/24/25/26/27 were merged (MOB-26 comments landed in
PR #306, MOB-27 in #297), as the issue requires for the last Phase-4 issue.

## What changed

### A. Board presence (`BoardPresence`, `presence.ts`)

The Board Detail header now shows a small “viewing” indicator built from the
existing MOB-06 room snapshot (`useBoardRealtime(...).userIds`, fed by
`presence:sync`). Rules, all in the pure `presenceView()`:

- Shown only while the room is `live`, the room still grants read, and the
  Board key is readable. `paused`, `checking`, `joining` and `unavailable` all
  hide it. The MOB-06 room already empties `userIds` on join, pause, revoke and
  session reset, and buffers a snapshot that arrives before the join ACK.
- You are never counted. Several devices of one user count once.
- Names and avatars come only from the explicit Board roster (MOB-25 pages,
  via the new shared `useBoardRoster`). The roster is requested only for an
  explicit OWNER/MEMBER **and** only when someone else is in the room.
- A Workspace read-only viewer sees a count only (“2 other people viewing this
  board now”) and never requests the roster. Ids the roster cannot name
  (unknown or deleted users) are counted as “and N more”, never named.
- It means “connected to this Board room now” — not last seen, typing, cursor
  or online-anywhere.

### B. Cross-feature convergence audit

Audited `parseHint`, `hintTargets`, the client branch order and every
`subscribeDenied` consumer (attachments, merged comments, My Tasks, realtime
client). The merged comments hook already scopes its listener to the
`members` key.

| Area                                              | Finding                                                                                                               | Result                                                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `presence:sync`                                   | Handled before the business-hint branch; updates room state only.                                                     | No refetch (test: 20 snapshots → 0 requests).                                                                                |
| Comment hints                                     | `comment:*` → comments + Card preview keys (+ Board activity).                                                        | 10 `comment:created` + 3 `comment:updated` + 10 presence → **1 GET** (comments), 0 Board/columns/checklists/attachments.     |
| Own POST + echo (merged MOB-26 `runCommentWrite`) | Echo arrives while the mutation refetch is queued.                                                                    | **1 comment GET**, 1 POST, 1 row.                                                                                            |
| Hints before room is live                         | Dropped (`rooms.isLive`).                                                                                             | 0 GETs; presence stays empty.                                                                                                |
| Checklist hints                                   | `changeScope: 'checklists'` stays child-scoped.                                                                       | 5 hints → 1 checklist GET, 0 comment GETs.                                                                                   |
| **Bug** – attachments                             | The attachments hook stopped uploads/downloads/viewer on _any_ child denial of the Board, e.g. a sibling comment 403. | Now stops only for its own Card attachments, the Board itself, or when Board read is gone. Regression test + mutation check. |

### C/D. Concurrency, uncertain writes, access loss

No new mechanism was needed; existing behavior was checked and is covered by
tests in MOB-06/17/20/21 and the merged MOB-26 suite:

- No compare-and-swap exists in the backend for Card fields, checklists or
  comments. Same-field edits are **last-writer-wins**. Comments show a remote
  change while editing and require _Load latest_ or _Keep editing_ before Save.
- Uncertain writes (timeout/network/5xx after the request started) are never
  replayed; comment `x-kanvexa-operation-id` is correlation only.
- Board/Workspace revocation, own `member:removed`, `access:changed`,
  authVersion/session change and background/foreground use the MOB-06
  lifecycle controller: room suspended, protected requests cancelled, REST probe
  decides denial vs. Workspace read-only, and presence is cleared.

## Verification

- `test/realtime/collaboration.test.ts` (Node): 6/6 — presence model, request
  traces above, presence cleanup on disconnect/revoke, POST + echo convergence.
- `test/board-presence.component.test.js` (Jest): 3/3 — names for explicit
  members, count without roster request, hidden in every non-live state.
- `test/card-attachments.component.test.js`: new sibling-denial test (mutant
  removing the scope check is killed).
- Mobile `eslint src test app.config.ts`, `tsc --noEmit`: pass.
- Full mobile `pnpm test` on `main` 3de8836 + this change: Node 486/486, Jest 38
  suites 506/506.
- `pnpm --filter @kanban/mobile test:realtime:local`: PASS (repository doubles,
  no PostgreSQL — not an E2E claim).
- `bundle:android` (export + native bundle verify): pass.
- Root `pnpm lint`: pass. Root web/backend `pnpm test`/`pnpm build` not run
  (no web, backend or shared files changed).

## Not done / not verified

- **Phase-4 real-backend E2E gate** (invite → Board add → mention → move →
  activity → revoke with two real accounts on NestJS + PostgreSQL + Socket.IO):
  **not run**. It needs a disposable database, a running backend and two device
  sessions; this machine has no emulator. `test:realtime:local` uses repository doubles, not PostgreSQL, and
  is not an E2E claim.
- No Android/iOS device or emulator here: background/foreground, intermittent
  network, 320dp, large text, TalkBack/VoiceOver and dark mode were not checked
  on a device.
- No presence indicator on Card Detail yet (Board header only).
