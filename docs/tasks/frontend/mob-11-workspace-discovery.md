# MOB-11 — Native Workspace discovery and switcher

Implemented [issue #259](https://github.com/duongkienvn/SE2026-T13/issues/259)
from freshly fetched main at `287c89da4de1f85d191e220e3a0b62d46c1b666c`.
Git ancestry verified the MOB-08 and MOB-10 delivery commits through
[PR #264](https://github.com/duongkienvn/SE2026-T13/pull/264) and
[PR #265](https://github.com/duongkienvn/SE2026-T13/pull/265).

## Verified API

The current Workspace controllers use bearer authorization and no-store
headers. MOB-04 unwraps the success envelope and normalizes transport errors.
The feature projects the current server DTOs with shared Workspace and Board
enums, capabilities, background IDs, and pagination types.

| GET path under /api      | Response and behavior                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| /workspaces              | Joined membership rows with page metadata. Uses limit 20 and requests all advertised pages within the server's page limit of 1,000,000. Deduplicates IDs, moves Personal first, preserves server join order for Teams |
| /workspaces/personal     | Own ensured Personal Workspace. Only used after a successful empty discovery result                                                                                                                                   |
| /workspaces/:id          | Member-only metadata, including role, canManage, canCreateBoards, icon, description and dates                                                                                                                         |
| /workspaces/:id/overview | Member-only metadata, Workspace member count, ACL-filtered Board counts and up to five recent Boards. Boards fetches only the selected Workspace's overview                                                           |
| /workspaces/:id/boards   | Member-only, readable Boards with page metadata. Defaults to active and updatedAt. Adapter supports status, search, starred, recent, sort and limits 1–100                                                            |

Board rows display roster counts only when the server supplies a number.
A Workspace-only Board reader gets a withheld count and retains read-only
access. Workspace role and Board role remain separate. A Board-only Guest
can use the existing canonical Board route when the Board API authorizes it.
The Workspace directory, Workspace overview and Workspace Board list do not
expose a Guest-only Workspace.

## Selection and handoff

`WorkspaceSelectionProvider` owns one in-memory preference. It is mounted
inside the existing auth, query and realtime providers. The preference is
bound to verified user ID and generation and cleared by the MOB-05 session-end
hook. It survives tab navigation. Personal is the default, with the first
accessible joined Team as fallback. Selecting a Workspace validates its ID
against the current authorized directory. It cancels the previous selection's
detail, overview and Board requests. Delayed responses and queued taps cannot
switch the current Workspace or put an old list under the new title.

Use `useSelectedWorkspace(active)` from an authenticated screen.
It exposes `identity`, `selected`, `selectedId`, `workspaces`, `directory`,
`setSelectedId(id)` and `isCurrentSelection(id)`. The selected Workspace
carries the server's capability flags. Query factories can be used directly
without importing the Boards screen.

| Export                    | MOB-04 key                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| workspaceDirectoryOptions | queryKeys.workspaces(identity, { limit: 20 })                                                 |
| workspaceDetailOptions    | queryKeys.workspace(identity, id)                                                             |
| workspaceOverviewOptions  | queryKeys.workspace(identity, id) with an overview suffix                                     |
| workspaceBoardOptions     | queryKeys.boards(identity, id, normalizedFilters), with page parameters in the infinite query |
| createWorkspaceApi        | Bound read methods for directory, Personal, detail, overview and individual Board pages       |

The Workspace route retains its canonical path and verifies membership
before displaying metadata. MOB-12 can extend that route and consume the
selection and overview factories. MOB-13 can consume the selection and
Board page factories for its directory and actions. MOB-14 owns privileged
Board behavior.

## Access and reconciliation

MOB-06 remains the only socket owner. A Workspace revocation fences detail,
overview and the Workspace's Board-list keys. Existing access reconciliation
evicts stale data and reloads joined memberships. Workspace-specific 403/404
also removes that Workspace and its private cache immediately and reconciles
the directory. Rejoining requires fresh authorized membership data. An
unverified or expired session cannot render the Workspace subtree.
Board access loss also evicts cached Workspace overview previews that may
contain the Board. The existing reconciliation owner reloads only active,
readable queries from REST.

A focused Boards screen observes only one selected list and overview. Manual
refresh reloads the directory first, then refreshes the still-selected
Workspace. Query identity, AbortSignal, and resource epochs guard each read.
An authorized in-memory view can remain visible during recoverable errors
with an offline or error notice. Selection changes do not invalidate Home
or My Tasks.

## Visual comparison

Screen 02's branded shell, title and subtitle, highlighted Workspace
selector, Personal/Team icons, selected check and modal layout are present.
The scoped All boards list uses real Board presets and metadata. The
starred carousel, search and filter controls, create/manage actions and
destructive menus are assigned to later issues. The read-only overview link
opens verified metadata.

Android API 37 with Expo Go 58.0.5 used the real login and a disposable
Nest/PostgreSQL instance. Checked the picker, hardware Back, selected and
empty Board lists, 375 dp light theme and 320 dp dark theme at 160% system
text. A second authenticated client revoked the selected Team membership.
The running app switched to Personal and the revoked option disappeared.
Expo's Tools button and the existing development navigation warning are
visible in some captures. The native My Tasks tab abbreviates at 320 dp and
160% text.

- [Boards at 375 dp](../../design/screens/implementation/mob-11-workspace-discovery/boards-light-375.png)
- [Workspace picker at 375 dp](../../design/screens/implementation/mob-11-workspace-discovery/switcher-light-375.png)
- [Boards at 320 dp and 160% text](../../design/screens/implementation/mob-11-workspace-discovery/boards-dark-320-large.png)
- [Picker at 320 dp and 160% text](../../design/screens/implementation/mob-11-workspace-discovery/switcher-dark-320-large.png)

## Verification

| Check                                                                   | Result                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile tests                                                            | Passed 177 Node tests and 91 component tests across 17 suites                                                                                                                                                                       |
| Mobile typecheck, root lint, root build                                 | Passed                                                                                                                                                                                                                              |
| Android Metro/Hermes export                                             | Passed. 2.5 MB bytecode, 1,323 native source entries, shared ESM and official branding                                                                                                                                              |
| Authenticated local Workspace smoke                                     | Passed on full current schema. Verified paging/filtering, stable Personal ID, authorized counts, null roster count, Guest Board access, Workspace 404 and unauthenticated 401                                                       |
| Local realtime smoke                                                    | Passed with two native controllers and the real Socket.IO server using repository doubles                                                                                                                                           |
| Workspace PostgreSQL regression script                                  | Failed in historical migration setup. The script excludes the migration that defines public.require_live_account_reference before running StarterBoardOnboarding. The separate authenticated smoke ran the full schema successfully |
| Root test                                                               | Shared 20 and backend 1,283 passed. Frontend 1,675 of 1,677 passed. Two unchanged Web tests exceeded the five-second timeout. The bounded rerun with four workers and 15 seconds passed all 1,677 tests                             |
| Changed-file Prettier and diff check                                    | Passed                                                                                                                                                                                                                              |
| Repository-wide Prettier                                                | 1,485 existing formatting failures                                                                                                                                                                                                  |
| iOS, standalone Android, physical devices and screen-reader walkthrough | Not run                                                                                                                                                                                                                             |

Coverage includes a 122-row directory, duplicate pages, malformed envelopes
and IDs, permission fields, Board pagination, selected-only overview reads,
fast A→B→A cancellation, logout/account replacement, mid-request access
loss, safe fallback, modal dismissal and canonical navigation.
