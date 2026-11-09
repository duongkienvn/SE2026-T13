# VT-054: executable export-job model

## Problem and scope

The existing Board export is synchronous; callers cannot observe a job while an export is in progress. This isolated executable model explores asynchronous submission, status and duplicate request handling around an injected export operation. It is not connected to Kanvexa's HTTP routes, database, authentication, or UI. Existing export remains unchanged. Production delivery, persistent jobs, multi-instance coordination, cancellation, expiration and actual download authorization are outside this experiment.

Acceptance criteria for this model:

1. A valid submission returns a job identifier and QUEUED status before its injected operation finishes; polling can observe RUNNING and COMPLETED, without an invented percentage.
2. Repeating the same user's key and input returns the same job, including after failure, without executing the operation twice. The same key with different input is rejected.
3. A failed operation produces FAILED and does not expose the raw exception. A retry of submission does not silently start another operation.
4. A user can inspect only their own job; invalid input and unknown or other users' job IDs are rejected.

Constraints: asynchronous operations must not block acceptance on completion; no new dependency, no real data, database or external service. Performance experiment: 120 simultaneously submitted jobs with a controlled fake exporter, measured from submission until completion; p95 target 3.5 s applies only to this simulated run and does not establish production latency.

Invariant: within one live model instance, `(user, idempotency key)` identifies at most one input and one execution. This deliberately does not assert database uniqueness, process restart safety, or real authorization. Real Board export must recheck ownership/session before releasing bytes as in `apps/backend/src/api/exports/exports.controller.ts`.

## Reviewed execution plan

Write Node built-in tests for this standalone model first; provide a no-behavior test fixture so failure is an assertion on the missing behavior, not an import error. Save RED, implement the minimum in the same isolated evidence directory, then rerun GREEN. Inject a controlled operation so state transitions and errors are deterministic. Use a response mapping assertion for the required mutation; run it in a temporary local Git branch or commit. Run real export baseline when possible; run no migration without an explicitly designated test database. A simulation does not exercise a real API or demonstrate authorization against Kanvexa.

The original proposal and two evidence-based revisions are recorded in README.md. File plan: `specification.md`, `job-model.test.mjs`, `job-model.mjs`, test/run logs, performance harness and report under this directory. No application code changes are planned. Node `--test` is a valid executable alternative for this isolated model, independent of Jest's cache issue. Expected regression: existing export Jest suite, if environment allows. Unit tests cover this model; a future real integration test must cover actual PostgreSQL uniqueness and authorization revocation, and a browser E2E is inappropriate for a model with no UI.

## Equivalence partitioning

| Dimension         | Class                            | Representative                           | Expected               |
| ----------------- | -------------------------------- | ---------------------------------------- | ---------------------- |
| User              | nonempty string                  | `alice`                                  | accepted               |
| User              | empty or non-string              | `''`, `null`                             | rejected               |
| Key               | nonempty string                  | `request-1`                              | accepted               |
| Key               | empty or non-string              | `''`, `null`                             | rejected               |
| Input             | nonempty Board identifier string | `board-1`                                | accepted               |
| Input             | empty or non-string              | `''`, `null`                             | rejected               |
| Request relation  | same user/key/input              | repeated `alice`, `request-1`, `board-1` | same ID, one execution |
| Request relation  | same user/key, different input   | `board-2`                                | conflict               |
| Request relation  | different user, same key         | `bob`                                    | separate job           |
| Job access        | owner                            | `alice`                                  | status returned        |
| Job access        | other user or missing ID         | `bob`, `missing`                         | not found              |
| Operation outcome | resolves / rejects               | controlled promise                       | COMPLETED / FAILED     |

These are representatives of classes, not an exhaustive input proof. Empty strings are also boundaries of the nonempty-string rule; no maximum length is claimed in this model. Partitioning groups inputs by expected behavior; boundary value analysis specifically targets values at and adjacent to numeric or length limits.

## Risk-based cases

| ID  | Risk / requirement      | Level | Preconditions / input                  | Expected                             | Priority |
| --- | ----------------------- | ----- | -------------------------------------- | ------------------------------------ | -------- |
| T01 | AC1                     | unit  | held operation                         | QUEUED before work                   | high     |
| T02 | AC1                     | unit  | operation started but unresolved       | RUNNING                              | high     |
| T03 | AC1 / mapping           | unit  | operation resolves                     | COMPLETED status maps correctly      | high     |
| T04 | AC2                     | unit  | duplicate submission before completion | same ID and one call                 | high     |
| T05 | AC2                     | unit  | duplicate after completion             | same ID and one call                 | high     |
| T06 | AC2 negative            | unit  | same key, different board              | conflict                             | high     |
| T07 | AC2 isolation           | unit  | same key, different users              | different IDs                        | high     |
| T08 | AC3 failure / duplicate | unit  | exporter rejects, retry same key       | FAILED, no raw error, no second call | high     |
| T09 | AC4 negative            | unit  | another user polls                     | not found                            | high     |
| T10 | AC4 negative            | unit  | unknown ID                             | not found                            | high     |
| T11 | AC4 input               | unit  | empty/non-string identity, key, input  | rejected                             | medium   |
| T12 | AC2 concurrency         | unit  | 120 same-key submissions               | one ID and one operation             | high     |

Integration/API and end-to-end production cases are planned but not asserted by model tests: real authentication, revocation at publication, concurrent PostgreSQL uniqueness and crash recovery require an actual implementation and designated disposable PostgreSQL. The harness tests are not a substitute for these levels.

The additional `export-characterization.test.mjs` invokes the existing `csvRow` source through the model with synthetic data. It checks one serialization after a duplicate request and the actual CSV output, but does not run the real Board export service or its authorization boundary.

`export-service-characterization.test.mjs` additionally invokes the real `BoardExportService.create` CSV path and owner check with synthetic repository and snapshot doubles. It is not a real database, HTTP, transaction, session or final-publication authorization test.
