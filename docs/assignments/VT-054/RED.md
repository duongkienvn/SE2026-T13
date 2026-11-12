# Test-first RED — execution record

Production baseline: `5c20856ba4686bac472c2cdb26cbf6dc51e83c76`; plan commit `b6efdfa`.

Command: `pnpm --filter @kanban/backend exec jest --runInBand --runTestsByPath test/exports/async-export.e2e-spec.ts --watchman=false`.

Result: exit 1; 1 suite failed, 1 test failed. Expected HTTP 202, received 404, assertion at test line 62. Nest boot and HTTP request succeeded; this is missing async endpoint behavior, not missing import/compilation. Full captured output: `evidence/red-http.txt`. pnpm additionally printed a misleading `Command "jest" not found` footer after Jest's failure output; the actual assertion above is the RED oracle. Baseline export suite independently passes 33 tests.

## Review test output (Codex self-review)

Keep: real Nest HTTP response and public response shape assertions. Modify in subsequent test-first cycle: add generator completion barrier, exact projection keys, stronger UUID pattern, retry/concurrency and fresh ACL/session cases. Reject: interpreting this one route test as evidence of idempotency or security. Guard override deliberately limits scope to authenticated contract routing. No production code has been edited at this checkpoint.

Prompt for next cycle: “Before implementing the job service, write retry/state/failure cases using controlled deferred work and exact response projection; preserve this 202 oracle. For persistence uniqueness/lease, add disposable PostgreSQL tests and do not treat mocks as proof.”
