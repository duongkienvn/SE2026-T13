# P4-05 — Due reminders and task email

This record describes the local implementation and verification, not a deployment.

The worker is disabled by default. Set `TASK_NOTIFICATION_JOBS_ENABLED=true` only
after applying the migration and explicitly authorizing the workload. Its poll
interval defaults to 60 seconds (15–300); `TASK_NOTIFICATION_BATCH_SIZE` defaults
to 50 (1–500). Task email dispatch additionally requires
`TASK_NOTIFICATION_EMAIL_ENABLED=true`. Queued work remains when dispatch is
off, but work older than 24 hours is cancelled rather than sent. Existing
security and invitation mail remains independent of these flags.

The scheduler interprets each Card due instant in the recipient's IANA timezone
(UTC when absent). Its reminder time is 09:00 on the preceding local calendar
day; a late assignment or due-date addition catches up while still before the
due instant. Repeated local 09:00 selects the earlier instant; a gap advances to
the first valid wall time. The occurrence digest covers recipient, Card, local
due date and `pre-due-v1`. The database remains authoritative; only a newly
created in-app notification triggers the existing private invalidation.
The indexed forward scan covers 72 hours to include long repeated local days;
each poll advances a bounded keyset page and checks the actual local schedule.
The scanner locks the Board and any Workspace read grant before the recipient
lock and rechecks current data inside the transaction. Workspace grant removal
and reminder creation therefore serialize at the relevant membership row.
The [STAB-01 follow-up](stab-01-backend-stabilization.md) adds a database-clock
prefilter before those locks and renews still-owned waiting leases at dispatch
time. Attempted expired leases remain `UNKNOWN`; business ineligibility remains
separate from lease expiry.

Task emails cover only assignment, explicit mention and due reminder, with
independent per-kind opt-in, verified recipient and current Board read access.
They contain event-specific generic text and a fixed authenticated Card link,
not copied Card or comment content. P4-09 should expose email preferences
independently of in-app preferences; toggling one does not alter the other.

| Source                                  | In-app preference  | Optional task email                | Occurrence                                             |
| --------------------------------------- | ------------------ | ---------------------------------- | ------------------------------------------------------ |
| New assignment of another user          | `cardAssigned`     | `cardAssigned`, default off        | Assignment UUID                                        |
| Explicit new comment mention            | `commentMentioned` | `commentMentioned`, default off    | Comment UUID + recipient UUID                          |
| Pre-due reminder                        | `dueReminder`      | `dueReminder`, default off         | Digest of recipient, Card and recipient-local due date |
| Invitations and account/security events | Existing policies  | Existing required mail, unaffected | Existing source contract                               |

Domain writes and optional email intent commit together. Email remains queued
without an in-app row when in-app is off. Before dispatch the worker resolves
the current verified address and rechecks preference, current Card/Board and
read access. A due email also requires a current assignment, future due instant,
and the same eligible local-date occurrence. No address or Card text is stored
in the outbox.

Outbox rows use `PENDING → PROCESSING → SENT`, `CANCELLED`, `FAILED`, `UNKNOWN`
or back to `PENDING` for an explicit retryable rejection. Attempts are bounded;
the retry schedule is 1, 5, 15, 60, 240 and 480 minutes, with at most six
attempts and a 24-hour age limit. `UNKNOWN` is terminal for automatic dispatch:
a timeout, uncertain provider result or expired lease after an attempt may have
been accepted. Operators must investigate rather than resend blindly. The
stable outbox-based provider key is useful within Resend's limited 24-hour
idempotency window; it does not promise exactly-once delivery. Unattempted
expired leases return to `PENDING`. The rolling 24-hour limit counts sent,
unknown and currently attempted rows, and excess is deferred or expires.
On graceful shutdown the worker stops its timer, waits for the active poll,
and releases its remaining leases using the same pending/unknown distinction;
expired leases provide recovery if the process cannot release them.

The six-attempt cap includes the initial send, so only the first five backoff
delays can precede a further attempt; the 8-hour entry is the final bound in
the configured sequence and cannot create a seventh attempt.

Normal logs expose only generic poll failures and status counts/messages, never
addresses, names, message content or provider payloads. Terminal rows are
retained as deduplication history; do not purge them merely because 24 hours
have elapsed. A later cleanup policy must preserve occurrence identities as
well as the full 24-hour rate-limit history, and requires separate review.
Take a backup and apply the forward-only migration explicitly before enabling
the worker. Creating the partial Card due index takes PostgreSQL's normal
index-build lock; assess table size and schedule the migration accordingly. Roll
back application code with the additive schema retained, or
repair forward; its down migration refuses destructive rollback.

For example, `Task email outcome: SENT` and `Task notification worker poll
failed` are safe static messages; investigate persisted statuses and timestamps
with authorized database tooling. An `UNKNOWN` outcome requires manual review.
Do not infer inbox delivery from `SENT` or print provider responses in logs.

The integration script refuses non-loopback hosts, requires
`NOTIFICATION_DATABASE_TESTS=local-only`, creates and drops a randomly named
database on a dedicated test server, and uses the fake mail transport. After
setting that flag and explicitly supplying `DATABASE_HOST`, `DATABASE_PORT`,
`DATABASE_NAME`, `DATABASE_USER`, and `DATABASE_PASSWORD` for the test server,
run `pnpm --filter @kanban/shared build` followed by
`pnpm --filter @kanban/backend test:task-notifications:database`. Never point
the test runner at a production server. Test accounts and addresses are synthetic.

## Local verification evidence

The dedicated loopback PostgreSQL test exercised the fresh migration chain and
a populated upgrade, competing scanners and dispatchers, independent channel
preferences, date edits, timezone changes, rollback, lease recovery, ambiguous
delivery, retry exhaustion, the rolling recipient cap, expiration, current ACL,
unassignment, archive and preference races, and a real Nest lifecycle with
fake mail. The P4-03 PostgreSQL/HTTP/Socket.IO suite passed its 16 groups. The
Card PostgreSQL regression passed 15 groups, including assignment/outbox
rollback, and the Comment PostgreSQL regression passed with mention replay.
The password-security and email-verification PostgreSQL/HTTP/Socket.IO suites
each passed 16 groups with disposable databases and fake mail.

The workspace build and lint passed. An initial root `pnpm test` run in the
restricted sandbox failed HTTP loopback connections and frontend timeouts. A
separate backend run outside the sandbox had two failing suites: its realtime
test double lacked the outbox transaction seam, and a mail test expected the old
provider count. Those fixtures were corrected and the affected suites passed
individually; a subsequent complete backend run passed 104 suites and 1,088
tests. The repository-wide `pnpm format:check` reported 955 unchanged files
with format drift; a check limited to changed source and documentation passed. These
results do not claim a production deployment or a real provider delivery.
The unchanged frontend passed all 122 files and 1,297 tests when rerun outside
the sandbox with `pnpm --filter @kanban/frontend test --maxWorkers=1`.

## P4-POL-01 presentation follow-up

The pure `task-notification-email.ts` renderer uses one branded 600px,
table-based layout for `CARD_ASSIGNED`, `COMMENT_MENTIONED` and `DUE_REMINDER`.
Each has its own static subject, heading, description, indicator and CTA, with
matching plain text, a copyable fallback link, mobile spacing and dark-mode
styles. The logo is the existing public, versioned brand asset without recipient
parameters; there are no tracking assets or additional action URLs.

The dispatcher passes only the persisted outbox kind through the typed `TaskMail`
contract. The existing task-kind union is reused with runtime narrowing.
Unsupported kinds follow the dispatcher's existing `CANCELLED` eligibility path;
direct renderer calls reject them, and mail transports return `FAILED` without
sending. The sender abstraction, idempotency key, retry/UNKNOWN handling,
eligibility SQL, leases, scanner and schema are unchanged.

Only event-category disclosure is authorized: no titles, names, comments, due
instants, account details or internal metadata enter either MIME part. The Card
link still requires a validated application origin and Board/Card UUIDs; HTML
values and link attributes are escaped. Sign-in and current permissions remain
necessary to open the destination.

STAB-01 was confirmed integrated in local and remote `main` before this change.
STAB-03 issue #211 had no integrated QA evidence; the user explicitly authorized
this scoped follow-up on the STAB-01 baseline with STAB-03 QA pending. This is
neither release sign-off nor deployment evidence.

Local verification for this follow-up:

- Focused mailer, dispatcher, worker and reminder Jest checks: 5 suites / 56
  tests passed. `pnpm test` with `VITEST_MAX_WORKERS=2` passed: backend 106
  suites / 1,133 tests, frontend 140 files / 1,472 tests, shared 20 tests.
- `pnpm --filter @kanban/backend test:task-notifications:database` passed all
  17 groups, including persisted-kind mapping and the existing STAB-01 races,
  consent, verification, ACL/revocation, rate, retry, stale and UNKNOWN checks.
  `pnpm --filter @kanban/backend test:notifications:database` passed all 16
  PostgreSQL/HTTP/Socket.IO groups. Both used disposable databases on a dedicated
  loopback PostgreSQL 16 container, synthetic accounts and fake mail.
- `pnpm lint` and `pnpm build` passed, including backend/frontend TypeScript
  compilation. The build retained the existing Vite NODE_ENV and chunk-size
  warnings. No standalone root typecheck script exists.
- Changed-file Prettier and `git diff --check` passed. Full `pnpm format:check`
  failed on existing repository formatting drift; no broad formatting was done.
- Three synthetic HTML/plain-text previews and exactly three screenshots were
  generated under ignored `.codex/previews/task-notification-email/`. The only
  preview substitution is a local copy of the existing logo. Chrome DevTools MCP
  hit a profile conflict; isolated headless Chrome verified 900px/360px layouts,
  600px maximum width, wrapping, 54px CTA height, loaded logo and dark-media
  colors, with no page exceptions or failed requests. Assignment/mention were
  captured at desktop width and the reminder at mobile width. Actual Gmail and
  Outlook rendering remains unverified. No real mail or deployment was performed.
