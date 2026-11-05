# P5-04 Calendar View (DX-02)

## Scope and contract

The Board calendar is a month view at `/boards/:boardId/calendar`; the default
Board route remains Kanban. The Board navigation and view selector retain URL
search parameters. The existing Card permalink opens Card Detail and returns to
the originating calendar when opened from it. Board background and permissions
remain owned by the existing Board page.

Calendar cards are the authorized active Board cards, fetched through the
existing paginated Card API. With filters, every page of the existing filtered
query is requested and shares its query-key invalidation prefix. The calendar
groups a Card by its due instant in the user's saved IANA time zone; start dates
do not place cards. Archived and undated cards do not appear on a day. Days
start on Sunday; the grid contains five or six weeks with adjacent dates.
Within a day, cards sort by due instant and ID, with additional entries exposed
through a disclosure. Preview summaries, labels and member information use the
existing authorized queries. The inspector is read-only and opens the existing
Card Detail for changes.

P5-05 can extend `BoardViews` with a real Table destination and add a matching
Board navigation item. It must keep the same Board/filter context and avoid a
second Card data model. No Table route or simulated Table functionality is
introduced here.

## Verification and remaining work

The supplied P5-04 issue and Calendar image are the visual and scope reference,
subject to the project's branding and access rules. Table remains a P5-05
handoff: the issue's request for a functional Table switch cannot be verified
until that view exists, and no fake destination is provided here.

An isolated PostgreSQL container and local backend/frontend were used for a
browser check with temporary test data. The lake preset remained visible and
unchanged while switching Calendar → Board → Calendar. Browser interaction also
confirmed that Escape closes the inspector and returns focus to its Card.
The inspector opened the existing Card Detail and closing it returned to Calendar;
a keyword filter remained in the URL and visible while switching both ways.
Desktop, tablet and mobile screenshots in dark and light themes are stored in
[`docs/design/screens/implementation/p5-calendar-view/`](../../design/screens/implementation/p5-calendar-view/).
The first capture exposed a tablet/mobile scrolling problem; the saved captures
show the subsequent correction. These screenshots do not establish full
keyboard, contrast, permission, offline, or concurrent-update coverage. The
mobile Card and navigation touch targets were increased and existing icons were
reused after these captures.

Focused tests covered calendar arithmetic, time zones, filtered pagination,
inspector/overflow, realtime Card creation, access revocation and Kanban
regression. The full frontend suite passed with four workers (142 files, 1,477
tests); the later Calendar test file passed all five tests independently,
including archived Boards and Workspace viewers. The default workspace test
run was stopped after concurrent tests produced many timeouts. Real concurrent
updates and a full manual accessibility audit have not been verified.

Local checks: `pnpm lint` and `pnpm build` passed. `pnpm format:check`
reported 1,105 files, mostly outside this change; the changed text files
passed a separate Prettier check. `pnpm --filter @kanban/backend test` passed
113 suites and failed to load one while a concurrent shared build replaced its
output; a separate rerun of `test/auth/auth-rate-limit.e2e-spec.ts` passed both
tests. The workspace `pnpm test`
was stopped after extensive timeouts under concurrent load; the frontend suite
was subsequently rerun successfully with a four-worker limit.
