# Starter Board onboarding

Scope: DX-03 onboarding guidance, with AC-01 account deletion compatibility.
Only genuinely new local/Google accounts enroll. Existing accounts are not
backfilled. Sample data uses existing Board/Card entities and normal views.

The registration transaction owns account, Personal Workspace and template v1
creation. A User row lock and one durable enrollment per User serialize retries.
The Board reference becomes null after removal; this tombstone prevents reseeding.
There is no startup migration, public provisioning endpoint or reconciliation seed.

Removal is restricted to the original user as current sole Board OWNER in their
Personal Workspace, with PRIVATE visibility and no collaborative history/data.
An owner-only preview returns a persisted graph digest. Removal rechecks it under
the existing Board lock. The exact phrase is `REMOVE SAMPLE BOARD` for pristine
data and `DELETE MY CUSTOMIZED BOARD` after any detected change. Stale previews
must be refreshed. File deletion reuses existing durable attachment cleanup
triggers; no provider calls occur inside transactions.

Migration adds only `starter_board_provisions`; no existing rows change. Empty
rollback is supported; rollback after enrollment refuses to discard provenance.
Account deletion explicitly erases this private enrollment after normal blockers
are resolved. Operational rollout requires the ordinary explicit migration step.
