# [BT3][23001908][VT-054] Async task progress and retry safety

Board owners can start an export from Data & Privacy, see its progress and receive the file when the background job completes. Repeating the same operation key reuses the persisted job, including concurrent retries. Existing synchronous Board and account downloads remain available.

- Student: Vũ Quang Nam (23001908), SE2026-T13, APP-02, VT-054.
- Baseline: `5c20856ba4686bac472c2cdb26cbf6dc51e83c76`.
- Scope: PostgreSQL job identity and lease, explicit retry, status/download routes, current OWNER and JWT checks, TTL/account cleanup, and session-scoped progress UI.
- Test-first: HTTP 404 → 202, mapper policy 12 RED → 12 GREEN, PostgreSQL schema RED → GREEN, UI 7 RED → GREEN, and worker drain 4 → 12 completed in a tick. Details in the assignment evidence.
- Mutation: the response format mapper forced JSON on an isolated commit. The CSV partition failed, and the restored mapper passed all 12 tests. Mutant commit is absent from this branch.
- Verification: real PostgreSQL service and JWT HTTP tests, plus eight Chromium desktop/tablet/mobile and theme journeys. Two randomized Jest seeds and three database repeats passed. Coverage metrics are scoped to the tested files.
- Load: 120 concurrent logical operations with duplicate POSTs, 120 completed and 120 attempts. Ack p95 2.98 s meets 3.5 s. Completion p95 10.83 s misses 3.5 s. Results use one empty Board and one local session.
- Gates: root lint and build pass. Root test reported timeouts, with separate workspace checks documented in the report. Root formatting reports existing checkout differences.
- AI disclosure: Codex assisted with planning, tests, patch, review and report. Original failures and corrective prompts are linked in the evidence. Human review is pending.

[Reproduction README](https://github.com/duongkienvn/SE2026-T13/blob/assignment/23001908-vt054-async-progress/docs/assignments/VT-054/README.md) · [Report PDF](https://github.com/duongkienvn/SE2026-T13/blob/assignment/23001908-vt054-async-progress/output/pdf/BT3_23001908_VT-054.pdf) · [AI Usage Log](https://github.com/duongkienvn/SE2026-T13/blob/assignment/23001908-vt054-async-progress/docs/assignments/VT-054/AI-USAGE.md)

Draft for review. Apply the new migration explicitly in an authorized environment before enabling the worker.
