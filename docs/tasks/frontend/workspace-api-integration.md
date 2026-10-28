# Workspace frontend API integration

Local implementation record, 2026-10-28. Integrates the existing
[#113 shell and Overview](workspace-shell-overview.md) and
[#114 Boards UI](workspace-boards-ui.md) with the
[#111 backend contracts](../backend/workspace-core-api.md). This record describes
the checkout and local verification, not a deployment.

## Implemented behavior

- Both production gateways are available and use the existing REST utilities.
  Discovery loads every `/workspaces` page (`limit=100`) for the directory and
  selector; it never infers Workspace membership from Board membership.
- Overview reads `/workspaces/:id/overview`. Counts come from the server;
  `memberCount=null` stays unavailable. Recent links retain Board IDs, timestamps
  and archive/read-only state. No metric is derived from the recent subset.
- Team creation posts only name/description to `/workspaces`. The existing form,
  confirmed navigation, duplicate-submission protection and draft retention are
  reused. Creation mutations explicitly disable automatic retries.
- Workspace Boards uses `/workspaces/:id/boards`, with server search, active or
  archived status, sorting and 20-item pages. URL `q` maps to `search`,
  `updated-desc` to `updatedAt`, and `name-asc` to `name`. Page, total and page count
  come from the response envelope, including empty `totalPages=0` responses.
- Creation permission comes from `workspace.canCreateBoards` in Overview, not
  Workspace role or invented list metadata. Workspace MEMBER can create under
  the current backend default policy. The empty Overview links to the existing
  Workspace Board creation dialog when allowed.
- Board creation reuses `POST /boards` with the selected `workspaceId`. The server
  assigns PRIVATE visibility and Board OWNER. Navigation reuses `/boards/:id`.
- Archive/restore reuses existing commands and confirmation dialogs. Capabilities
  derive from Board OWNER and archive state; Workspace ADMIN confers no Board
  administration. `canEdit` describes collaboration and is not restore permission.
- Board description stays nullable; Board member counts stay unavailable because
  the DTO supplies no permitted count. Workspace icon and management/timestamp
  fields have wire types but do not introduce new controls or presentation.

The small `response.ts` boundary keeps wire DTOs and presentation mapping in the
frontend. No backend implementation, shared package, dependency or lockfile changed.
Existing composition, branding, forms, hooks, URL filters and navigation remain.
Separate QA entries retain explicit unavailable scenarios even though production
gateways now connect to real HTTP. Fixtures remain outside production imports.

## Session, access and cache behavior

Reads still use `runAuthorized`, AbortSignal and user/session/Workspace query keys.
No previous-page placeholder data is introduced. Authentication expiry clears the
session; denied Workspace reads hide and clear all resource/filter pages and remove
the directory entry. Account switching and logout cannot apply old responses.

Board creation invalidates the Workspace resource and existing Board lists. A 404
creation response clears Workspace access; a 403 drops the creation capability and
refetches Overview. Existing Board create/update/archive/restore hooks also
invalidate the current session's Workspace queries, so returning from a Board
refreshes names, counts, recents and archive status. Mutation callbacks ignore an
ended session.

The existing Board revocation boundary now clears cached Workspace resources,
including pages where the affected Board is not present but contributes to totals,
before rechecking REST. Independent Workspace directory membership remains.
Concurrent archive-state conflicts refetch Board and Workspace state.

## Dependencies and exclusions

- `WORKSPACE_VISIBLE` remains disabled until #115 supplies the complete grant,
  nullable Board role and REST/Socket.IO access contract. Both list and Overview
  mapping reject unsupported visibility/role responses instead of relabeling them.
- Invitation/member/settings management, activity, stars, Recent filtering, advanced
  filters, List view, custom icons, analytics and other Phase 2/3 features retain
  their existing Soon/Unavailable state. Billing remains excluded.
- There is no new Workspace membership/revocation event in #111. Reads revalidate
  on mount, focus and reconnect using existing Query behavior; future membership
  events belong to the corresponding backend access work.
- The backend Workspace migrations, including the icon migration, must be applied
  through the explicit release process before using these APIs. No development or
  production database migration or deployment was performed here.

## Verification

Verification uses Node 22.17.0 and pnpm 10.18.3. Focused tests exercise production
adapters through the real envelope utilities and fetch boundary, and route tests
use the default gateways without context substitution. They cover mapping, paging,
Bearer authentication, cancellation, permissions, Team/Board creation, navigation,
archive/restore, read/write access loss and POST retry prevention. Existing tests
continue to cover switching, logout, background denial and unsupported features.

Actual-backend checks used a dedicated PostgreSQL 16 container bound only to
localhost and a separate `workspace_frontend_test` database. The local harness
explicitly configured the database and ran migrations there; mail used the fake
test transport. The existing backend Workspace integration suite additionally
created and dropped its own random database on that test server. No `.env`
database credentials or production data were used.

Lightweight browser checks used the normal app entry with the actual backend:
login, Personal discovery, Team creation, Overview, Board creation and navigation,
archive/restore, server search/sorting, and page 2 of 21 Boards. Desktop/mobile
layout, console and request checks are recorded with the final results below.

| Check                                                       | Result                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                 | PASS, including final source changes                                                                                                                                                                                      |
| `pnpm test`                                                 | PASS: backend 61 suites / 621 tests, frontend 96 files / 876 tests, shared 7 tests                                                                                                                                        |
| `pnpm build`                                                | PASS; final frontend source also checked with `pnpm --filter @kanban/frontend build`                                                                                                                                      |
| `pnpm --filter @kanban/backend test:workspace-api:database` | PASS on the dedicated local test PostgreSQL server: actual HTTP/JWT, lifecycle, privacy, pagination, rollback and concurrency                                                                                             |
| Lightweight actual-backend browser checks                   | PASS: discovery/selector/Overview, creation, Board navigation, archive/restore, search, sorting and pagination                                                                                                            |
| Browser layout/console/network                              | PASS at desktop 1280×800 and mobile 375×812; no horizontal overflow, refreshed page has no console warnings/errors and Workspace requests return 200. Development StrictMode cancels duplicate initial reads as expected. |
| `pnpm format:check`                                         | FAIL: 679 existing repository files are not formatted; unrelated files were left unchanged. Changed-file Prettier check recorded below.                                                                                   |

Changed-file Prettier, local Markdown link/path checks and `git diff --check`:
PASS. Repository-wide formatting failures are outside the changed-file set.

The first build found two test-only typing mistakes, corrected before the passing
build. A subsequent full test run exposed an unnecessary Workspace invalidation
when no Workspace resources existed; fixed and verified by the existing realtime
queue test and the final passing full suite. Build retains existing Vite warnings
about root `.env` NODE_ENV and bundle size. Browser HMR errors seen during source
writes cleared on the final reload; the local Google origin warning on login is
outside Workspace scope. These are not API verification failures.

No screenshot campaign, new UI composition, remote action or release smoke check
was performed. Database test fixtures and local harnesses are not production
code. Welcome Email implementation was already in the clean base and was not
edited. Exactly one local commit is authorized for this integration.
