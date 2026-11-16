# MOB-14 Native Board lifecycle and settings

[Issue #263](https://github.com/duongkienvn/SE2026-T13/issues/263) ·
[Boards reference](../../mobile/assets/02-boards-and-workspace-switcher.png) ·
[Board reference](../../mobile/assets/03-board-detail-and-filters.png)

## What changed

The app now has a Board settings screen at `/boards/:boardId/settings`. You
can open it in two places:

- the new **More actions** (`⋯`) sheet on each row in the Board directory and
  Shared boards list. The sheet holds **Edit details** (active explicit owners
  only, using the MOB-13 `BoardEditor`) and **Board settings**.
- the **Board settings** link in the Board Detail header.

The settings screen reads the Board again with `GET /boards/:id`. It shows the
name, description, visibility, Workspace, your role and whether the Board is
archived. It then offers only the actions that the server's explicit Board role,
capabilities and Board policy allow. It reuses the MOB-13 editor and star; it
does not add a second edit screen. The four tabs are unchanged.

## Source-verified contracts (checked on `main` at `bc3c0ab`)

| Action         | REST under `/api`                                                                                          | Mobile rule                                                                                                                                                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Details        | `GET /boards/:id` → 200 `BoardResponseDto`                                                                 | Settings key `[…board, 'settings']` sits under the Board key, so realtime `board:*` hints, eviction and logout cover it. A 403/404 revokes the room and shows the non-disclosing unavailable state.                                                                                                                     |
| Policy         | `GET /boards/:id/policy-capabilities` → 200 `{canInviteMembers, canChangeMembership, canChangeVisibility}` | Fetched only for an active explicit owner. Visibility is offered only when `canChangeVisibility` is true; otherwise the screen explains why.                                                                                                                                                                            |
| Archive        | `POST /boards/:id/archive` → 200                                                                           | Active OWNER. Confirmation says the Board becomes read only and its data is kept. The response must be archived.                                                                                                                                                                                                        |
| Restore        | `POST /boards/:id/restore` → 200                                                                           | Archived OWNER with `canRestoreBoard`. Sent as a read-access resource, because the local fence treats archived Boards as not writable. The response must be active.                                                                                                                                                     |
| Visibility     | `PATCH /boards/:id/visibility` `{visibility}` → 200                                                        | Only the two `BoardVisibility` values from `@kanban/shared`. It warns when widening (Workspace members can read) and when narrowing (Workspace-only readers lose access).                                                                                                                                               |
| Move           | `POST /boards/:id/move-workspace` `{destinationWorkspaceId}` → 200                                         | Destinations are the joined Workspace directory filtered by `canCreateBoards`, excluding the source. A warning says the Board becomes PRIVATE. The response must land in the destination and be PRIVATE (same-Workspace no-op excepted).                                                                                |
| Sample review  | `GET /boards/:id/sample-removal` → 200 preview                                                             | Requested only when `isStarterBoard` is true and you are OWNER. The version must be 64 lowercase hex characters, and the phrase must match `isCustomized` exactly.                                                                                                                                                      |
| Sample removal | `DELETE /boards/:id/sample-removal` `{version, confirmation}` → 204                                        | Single-shot. The button stays disabled until the typed text matches the server phrase. `STARTER_BOARD_CHANGED` loads a new review and clears the text. `STARTER_BOARD_REMOVAL_UNSAFE` removes the option. On 204 the room is revoked, Board caches are evicted, lists are invalidated and the app returns to `/boards`. |

**Discrepancy with the issue text.** The issue points to
`GET /workspaces/:id/policies` for the visibility policy. That endpoint
requires Workspace membership, so a guest Board OWNER cannot read it. The
current Web Board Settings reads `GET /boards/:id/policy-capabilities`
instead. That endpoint is authorized by Board read access and already combines
the owner check with `boardVisibilityChangesEnabled`. Mobile follows the Web
and the backend source. Workspace policies are never changed here.

Commands that fail with 403/404 or 409 close their dialog and recheck the
Board. On a 403/404 the MOB-06 access probe decides whether Board access was
really lost. Policy and sample-review reads use child resource keys, so a
child 404 such as `STARTER_BOARD_NOT_FOUND` triggers a probe without throwing
away verified Board state. Temporary failures (offline, 429, 503, timeout)
keep the dialog and your choice, and they respect `Retry-After`. Only one
command can run at a time.

## Role matrix (covered by component tests)

| Viewer                                          | Shown                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| Explicit OWNER, active Board                    | Edit, visibility (if policy), move, archive, star                    |
| Explicit OWNER, archived Board                  | Restore, star, read-only notice                                      |
| OWNER of an eligible sample                     | The above, plus Remove sample board after a successful preview       |
| Board MEMBER                                    | Details only, plus "Only the board owner can change these settings." |
| Workspace-only reader (`currentUserRole: null`) | Details only, labelled "Workspace viewer · Read only"                |
| Workspace ADMIN who is not the explicit OWNER   | Details only, even if a capability flag says otherwise               |

## Later-phase entry points

Members, Invitations, Activity, Archived Cards, Export and Data/Privacy belong
to MOB-23–27 and MOB-40. They are left out, not shown as dead buttons.

## Verification

- `test/workspaces/board-lifecycle-api.test.ts`: exact methods, paths, bodies,
  200 envelope vs 204, contradictory responses rejected, 409 families, no DELETE
  retry, forged previews and malformed policy and starter hints rejected.
- `test/board-settings.component.test.js` (19 tests): the role matrix above,
  the policy gate, single-shot archive with one authoritative re-read
  afterwards, restore, visibility warnings, 409 and 503 handling, move
  destination filtering and the PRIVATE reset, access loss through the MOB-06
  probe, offline, the Android Back sheet close, and sample removal (exact
  phrase, version, `STARTER_BOARD_CHANGED` re-review with the stronger
  phrase, unsafe refusal, background re-review clearing the typed text).
- Mutation checks: removing the OWNER requirement, showing removal without a
  preview, dropping the `canCreateBoards` filter, skipping the move PRIVATE
  check and removing the re-review text reset each made a test fail. All were
  restored.
- `test/workspace-discovery.component.test.js` now opens the MOB-13 editor
  through the new overflow sheet (62/62 pass).

Checks run on 2026-11-15: `pnpm --filter @kanban/mobile lint` passed. `pnpm
--filter @kanban/mobile test` passed (248 Node tests; 23 Jest suites with 228
tests). `pnpm --filter @kanban/mobile build` passed, covering typecheck, the
Android Metro export and the native-bundle verifier. Root `pnpm lint` passed.
Prettier `--check --end-of-line auto` passed on every changed file. No
dependency or lockfile changed, so frozen-install compatibility is unaffected.
Root `pnpm test` and `pnpm build` were not run: Web and backend code are
unchanged.

**Not verified.** No Android device, ADB or emulator was available, and EAS
cloud builds were not authorized. As a result, these were not checked: native
screenshots, comparison with the reference images, 320dp width, large fonts,
dark-theme appearance on a device, TalkBack, reduced motion, and cross-device
Web↔mobile archive/visibility sync. iOS was not checked. No real or production
sample Board was used.
