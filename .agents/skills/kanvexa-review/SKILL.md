---
name: kanvexa-review
description: Review a Kanvexa feature branch, diff, or pull request for correctness, security, data isolation, and regressions using code evidence. Use for review requests; do not edit code unless fixes are separately requested.
---

# Kanvexa Review

Follow [AGENTS.md](../../../AGENTS.md). Paths below are relative to the repository root. Review does not authorize implementation or posting remote comments.

## Establish the review boundary

1. Inspect branch/status and the requested diff or PR. Confirm the base and intended scope; do not assume all dirty files belong to the review. If only a local diff is available, state that limitation without fetching or altering remotes unless requested.
2. Read acceptance criteria and changed code plus callers, contracts, tests, and relevant task records. For Post-MVP behavior, consult the relevant [roadmap](../../../docs/roadmap/post-mvp.md)/[blueprint](../../../docs/design/product-ux-blueprint.md) sections. Use architecture/design documents selectively and verify historical claims against source.
3. Prioritize reachable defects introduced or exposed by the change. Trace a concrete trigger and impact before calling something a bug; distinguish existing issues, questions, and unverified concerns.

## Trace affected boundaries

- **Authorization/isolation:** real guards and service checks, authenticated identity versus client-supplied IDs, resource-to-board relationships, owner/member rules, archived/read-only restrictions, creator/last-owner protection, cross-board/cross-user reads and writes. Check list/search/activity/payload paths as well as mutations; planned Workspace roles cannot silently widen private Board access.
- **Validation/contracts/privacy:** DTO unknown/null/omitted fields, bounds and identifiers, response allowlists and API envelope/status/error compatibility, shared exports, old clients, and safe logs/events. Swagger annotations alone do not enforce authorization. Look for leaked credentials, raw entities, SQL, or inaccessible Board data.
- **Persistence/concurrency:** transaction boundaries, Board row locks, uniqueness/foreign keys, exact position strings/arithmetic, reorder/restore races, assignment versus member removal, migration/backfill safety, and existing-data compatibility. Refer to the [backend guide](../../../docs/architecture/backend-developer-guide.md) and [database design](../../../docs/architecture/database-design.md) for the affected rules.
- **Realtime:** persistence before publish, publisher/broadcast recipient selection, room join membership validation, queue ordering, revocation/eviction, token invalidation/expiry, reconnect, and duplicate/out-of-order events. Trace REST success when delivery fails; check that no nested queue/broadcast path can deadlock or leak stale receive grants.
- **Frontend/session:** query keys and invalidation, REST/event races, optimistic rollback, stale-response guards, subscription cleanup, session changes/logout, reconnect resync, and clearing protected data on access loss. Review affected keyboard/responsive/error behavior and approved design scope for UI changes.
- **Tests:** look for missing negative authorization, archived states, concurrent requests, failed persistence/delivery, migration legacy-data cases, and session/access-loss regressions. Prefer tests proving behavior; mocks alone cannot demonstrate PostgreSQL locking or constraints.

## Validate and report

- Use [kanvexa-verification](../kanvexa-verification/SKILL.md) to run focused checks when useful and safe. Do not modify code to fix findings during a review-only request. State what was inspected and what was not tested.
- Present findings by severity with repository file/line, concrete triggering conditions, user/data/security impact, and an actionable remedy. Keep line ranges tight and use changed lines when possible.
- Use P0 for immediate critical impact, P1 for urgent serious defects, P2 for normal correctness/regression fixes, and P3 for low-impact actionable defects. Do not inflate severity for a hypothetical scenario with no evidence.
- Separate uncertainties/open questions from confirmed findings. Avoid generic praise, speculative defects, and style-only comments unless they violate a material repository contract. If no actionable findings exist, say so and disclose coverage gaps or residual risks; do not invent findings.
