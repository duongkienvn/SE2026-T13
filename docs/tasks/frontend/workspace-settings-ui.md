# Workspace Settings, policies and safe management UI V1

Local implementation record for
[#118 (P2-09)](https://github.com/duongkienvn/SE2026-T13/issues/118), 2026-10-30.
Uses the merged [P2-02 core API](../backend/workspace-core-api.md),
[P2-03 leave](../backend/workspace-members-invitations-api.md),
[P2-04 visibility](../backend/board-visibility-access-control.md) and
[P2-05 policies, move and deletion](../backend/workspace-policies-board-move.md).
Built on the [Members page](workspace-members-invitations-ui.md) (#117).
Frontend only; no backend, shared package, dependency or lockfile change.

## Routes and sections

`/workspaces/:id/settings` opens General on desktop (≥ 768 px) and a section
list on phones (each section has "Back to Settings"). Sections are child routes,
so refresh/Back/Forward keep the section:

| Section               | Route                  | API                                                    |
| --------------------- | ---------------------- | ------------------------------------------------------ |
| General               | `settings/general`     | `GET`/`PATCH /workspaces/:id`                          |
| Members & Invitations | `settings/members`     | Overview `memberCount`; links to `/members` (#117)     |
| Permissions           | `settings/permissions` | `GET`/`PATCH /workspaces/:id/policies`                 |
| Danger Zone           | `settings/danger`      | `POST /workspaces/:id/leave`, `DELETE /workspaces/:id` |

The Workspace Settings tab, sidebar item and switcher destination are now
Available. Workspace tabs and the breadcrumb match nested section paths. Account
Settings (`/settings/*`) is unchanged.

Query keys: `workspaceKeys.detail` and `workspaceKeys.policies` sit under the
Workspace resource, so `revokeWorkspaceAccess`, logout and realtime
`clearAccessSnapshots` clear them with the rest of the Workspace.

## Behavior

- **General** — ADMIN edits name (1–120, trimmed), description (≤ 2,000,
  empty → `null`) and one of the five approved icons (or the initial). Only
  explicitly edited fields that differ from the latest server values are sent.
  Untouched fields follow server refetches, including concurrent description
  and icon updates from another admin. Edits survive temporary refetches and
  failed saves; confirmed loss of editing permission clears them.
  Save/Cancel are disabled until something changes; an unsaved-changes guard
  covers route changes. Success invalidates the whole session's Workspace data
  (header, sidebar, switcher, directory). MEMBER sees read-only fields and no
  Save. The Workspace avatar now shows the chosen icon. Type is shown, not
  editable.
- **Members & Invitations** — permitted member count, own role, an
  explanation of who may invite, and links to the real Members page,
  Invitations tab and invite dialog (ADMIN on Team only). No second roster.
- **Permissions** — exactly the four P2-05 booleans, as two-option segmented
  radios with a one-line effect of the current choice. Only changed fields are
  sent. `canManagePolicies` (from the server) decides editing; MEMBER sees the
  current rules disabled. Text states the rules only limit Board owners and
  never grant PRIVATE access. Success invalidates the Workspace resource, the
  directory and all Board queries (create/invite/visibility capabilities).
- **Draft lifetime** — General and Permissions keep their draft owners mounted
  during temporary Socket.IO disconnections, `access:changed` revalidation and
  recoverable read failures. Protected fields stay unrendered until reads are
  authorized again. Drafts stay only in React memory, keyed by user, auth-session
  generation and Workspace; confirmed 403/404 access loss, Workspace revocation,
  or loss of editing permission clears them. Authentication/session changes
  remount the owner, detaching callbacks from earlier saves. Explicit Cancel
  clears the draft; successful General saves clear acknowledged edits while
  preserving any newer input typed during the request. Permissions controls
  remain disabled during saves.
  Leaving the section retains the existing unsaved-changes guard/discard flow.
- **Danger Zone** — Leave (Team only) and Delete (Team ADMIN only), each
  confirmed; Delete needs the exact name typed and sends it as
  `confirmationName`. The server decides last-ADMIN and zero-Board rules; 409
  shows "last admin" or "still has boards (including archived or private ones
  you cannot see)" without counting hidden Boards. On success the page leaves
  first, then drops the Workspace's cached pages and refreshes the directory.
  Personal: both disabled with a reason.

## Board OWNER controls (minimal Phase 2)

In the existing Workspace Boards card menu, only for an explicit active Board
OWNER (never inferred from Workspace ADMIN):

- **Change visibility** — Private / Workspace (read-only for non-members).
  Enabled only when `GET /boards/:id/policy-capabilities` says
  `canChangeVisibility`; widening shows a warning and "Share with workspace".
- **Move to workspace** — destinations are joined Workspaces whose
  `canCreateBoards` is true (current one excluded). Explains that the link and
  Board members stay and visibility resets to Private.

Both succeed only after the server responds; any result invalidates all
Workspace and Board queries (old and new Workspace lists/Overview). 404 revokes
Board access. Full Board Settings remains Phase 3 (BD-03).

## Evidence

Screenshots in
[implementation/workspace-settings/](../../design/screens/implementation/workspace-settings/)
(17, all viewed): General at 768/1366/1920 (light, dark, MEMBER read-only),
Permissions at 1920 and 390 (ADMIN) and 1366 (MEMBER), Members & Invitations,
Danger Zone (Team, Personal, dark), delete confirmation, phone section list and
General, Board visibility and Move dialogs. Production build with Playwright
route mocks.

- No horizontal overflow at 320/375/390/768/1280/1366/1920.
- As on the merged Overview and #117, the tall Workspace header makes sections
  scroll on short laptops (General 333 px, Permissions 347 px at 1366×657);
  1920×945 nearly fits (45–59 px).

## Checks

- Root `pnpm lint` exit 0; frontend `vitest` 929/929; root `pnpm build` pass;
  `git diff --check` clean; prettier (auto EOL) clean on changed files.
- 15 new tests (General save/validation/conflict/read-only, Permissions
  diff/read-only, Members links, leave/last-admin, delete name + 409, Personal,
  Board OWNER visibility/policy/move/non-owner). Mutation check 7/8 caught; the
  uncaught one is the delete submit guard, which is also enforced by the
  disabled button.
- Not run: real backend + PostgreSQL integration (no designated database in
  this session).

## PR #131 review follow-up (2026-10-30)

Both Codex P2 threads were verified against the current forms and addressed:
General now stores explicit field edits, and both form owners survive temporary
access revalidation while hiding protected fields. Confirmed denial resets the
owner, so callbacks from a save under revoked access cannot clear a new draft.
General save acknowledgements also preserve newer edits entered during saving.

History was reconciled locally before implementation. The original four
Settings commits (`4d9322c` through `4b15fbe`) were replayed onto the fetched
`origin/main` (`1ab6028`), which already contains #130's `bbf78cd` review fix.
`git range-diff` retained all four Settings patches; only the existing header
import context adapted to main. Main is now an ancestor, the #130 member and
invitation files match main, and the header retains its filter-preserving
Invite link alongside Settings' icon support. No merge commit or duplicate
#130 patch was introduced. The original tip is retained at the local backup
ref `codex/pr131-before-reconcile`; remote branches and PR metadata are unchanged.

Regression coverage adds 28 cases to the existing Settings suite (43 total):
each metadata field versus concurrent updates; Socket.IO disconnect/reconnect
and `access:changed`; recoverable read failures; socket/403/404 revocation and
regrant; editing-permission loss; same-account session replacement, account
switching and logout; and pending saves across temporary/confirmed access loss.
The seven core concurrency/revalidation cases were also run against the
original forms and failed as expected; the fixed files were restored afterward.

Browser QA used isolated fixtures at 1440×900 light and 375×812 dark: General
retained a local name draft and followed concurrent description/icon changes,
PATCHed only the name, and hid fields during revalidation. Permissions retained
local choices across a temporary interruption and reset them after revocation.
No horizontal overflow or console errors after a clean reload. Existing styles
and backend contracts are unchanged; the temporary QA harness was removed.

Local verification:

- `pnpm lint` and `pnpm build`: pass. Build reports the existing Vite
  `NODE_ENV` and chunk-size warnings.
- `pnpm test` with `VITEST_MAX_WORKERS=2` and
  `npm_config_workspace_concurrency=1`: pass (shared 7, backend 687, frontend
  979 before the final three save-order cases). Final
  `pnpm --filter @kanban/frontend test --maxWorkers=2`: 982/982 pass, including
  all 43 Settings tests. No repository test configuration was changed.
- `pnpm format:check`: fails on 805 untouched CRLF files in this Windows
  checkout. All four changed files pass the configured Prettier check; the
  full repository passes `pnpm exec prettier --check . --end-of-line auto`.
  `git diff --check` and local documentation link/path checks pass.
- Real backend/PostgreSQL integration: not run; no backend, schema or API
  contract changes. No remote review replies or thread resolutions performed.

## Deferred

- Workspace activity, notifications and a Guest list stay out of scope.
- Full Board Settings (General/Members/Permissions/Danger Zone) is Phase 3.
- Accept-invitation success still links to `/workspaces` (no workspace id in
  the accept DTO).
