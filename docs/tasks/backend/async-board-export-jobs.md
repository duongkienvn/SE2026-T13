# VT-054 — Asynchronous Board export jobs

This task extends [DX-01 export](p5-authorized-data-export.md) with persistent jobs. It is local implementation evidence, not deployment. Assignment specification, test design and raw evidence are in [VT-054](../../assignments/VT-054/SPEC-PLAN.md).

## Contract

All routes require the verified JWT user and current Board OWNER access. Jobs are private to the user who created them; another OWNER cannot read their job.

| Method / path (under `/api`)                    | Behavior                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| POST `/boards/:boardId/export-jobs`             | Body `{format: 'json'                                              | 'csv'}`(default JSON), UUID v4`Idempotency-Key` header, 202 raw job response |
| GET `/boards/:boardId/export-jobs/:id`          | Raw job response, without file bytes, key or lease                 |
| POST `/boards/:boardId/export-jobs/:id/retry`   | 202, same job identity; failed attempts below 3 may become pending |
| GET `/boards/:boardId/export-jobs/:id/download` | Binary attachment after fresh authorization/session checks         |

Public fields: id, state, format, attempts, expiresAt, progress, error. PENDING progress is 0; RUNNING and FAILED progress is null; COMPLETED is 100. Failure error is the fixed `EXPORT_FAILED`, never an internal exception. Reusing a user/key with different Board or format gives 409; expired jobs give 410; premature download gives 409. New routes use the existing private/no-store middleware, including errors.

## Persistence and lifecycle

The explicit `AsyncBoardExports1794787200000` migration adds `board_export_jobs`; it does not run automatically. The unique user/key constraint fences concurrent retries. Job/result lifetime is 15 minutes. Metadata keys survive result expiry until account cleanup or parent hard deletion, preventing accidental recreation by late retries. Account private-state erasure explicitly deletes job rows; the existing live-account trigger also protects new inserts against deletion races.

A local worker polls every 250ms with at most 4 concurrent attempts. Claims use a transaction, ordered `LIMIT 1`, `FOR UPDATE SKIP LOCKED`, and a random 60-second lease. Generation reuses read-only `BoardExportService`; it holds no job transaction while generating bytes. Conditional completion checks lease token/state/deadlines. A late attempt cannot overwrite a reclaimed attempt. Up to 3 attempts may run; FAILED requires explicit retry. Sweeps discard expired bytes and terminalize expired/exhausted jobs. Bytes remain capped at the existing 20 MiB limit.

A populated migration down refuses to discard keys/jobs. Preserve the table and roll forward or use a reviewed backup/retention plan. Existing sync Board and account export contracts remain available.

## Current verification and gaps

Focused Jest: 46 tests pass (HTTP route contract uses service stub; policy and existing export regression tests). PostgreSQL: 7 service integration groups pass, including 120 same-key starts/retries, real JSON export, fault injection, lease recovery, stale completion, current OWNER revocation, expiry cleanup and account-private-state cleanup. Schema harness confirms unique identity and no TypeORM schema drift.

These checks do not yet prove the full HTTP/JWT scheduler journey, frontend integration, production throughput or deployment. The baseline oversized-export database test encountered EXPORT_TIMEOUT rather than expected EXPORT_TOO_LARGE; its log is retained. Assignment verification and final gates are ongoing.

## Frontend integration and browser verification

The Data & Privacy Board action now calls job start/status/retry/download with the existing session-scoped authorization boundary. Operation keys survive a lost acknowledgement or retry; they reset after success, expiry, exhausted attempts, changed Board/format, or changed session generation. The account download remains synchronous. Phase text is visible and announced; the existing controls remain disabled while work runs. No percentage is fabricated for RUNNING.

Focused frontend tests passed 69 cases across API workflow, progress component, page, API client and file handling; the active-timer abort test additionally passed in a 6-case API run. Builds and focused lint passed. The production frontend was then exercised with actual Nest JWT REST, Socket.IO and disposable PostgreSQL at 4 viewport sizes in both system light/dark modes. Each journey starts via keyboard, observes RUNNING, verifies no page overflow and validates the downloaded JSON and filename. See [browser evidence](../../design/screens/implementation/vt054-async-export/README.md) and assignment raw logs. This supersedes the earlier checkpoint's statement that browser integration had not yet run; it does not imply final quality gates, mutation/performance, deployment or physical device testing are complete.

The browser harness first forwarded REST alone and omitted the realtime server. The existing access-snapshot protection correctly cleared stale rights and blocked file publication. Harness configuration was corrected to use the same real server for REST and Socket.IO; application security behavior was preserved.
