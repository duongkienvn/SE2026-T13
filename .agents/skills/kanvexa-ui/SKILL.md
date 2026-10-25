---
name: kanvexa-ui
description: Implement or refine Kanvexa React screens, components, responsive layouts, and accessible interactions against approved UX specs and visual references. Use for frontend UI work; combine with kanvexa-feature when backend or shared-contract changes are required.
---

# Kanvexa UI

Follow [AGENTS.md](../../../AGENTS.md). Code-span paths below are relative to the repository root.

## Select the correct design context

1. Inspect the affected route, feature, API/query hooks, shared components, tokens, and tests. Check what the backend actually supports before designing controls.
2. Read the [base design guidelines](../../../docs/design/design-guidelines.md). For Post-MVP work, also read the relevant [blueprint](../../../docs/design/product-ux-blueprint.md) sections and [Post-MVP addendum](../../../docs/design/design-guidelines.post-mvp.md), and check the requested scope against the [roadmap](../../../docs/roadmap/post-mvp.md).
3. Select the screen's UX spec and approved image through the [visual reference register](../../../docs/design/post-mvp/visual-reference-register.md). Read/view only the relevant area. Text scope/security overrides govern conflicting image details; existing MVP visual baselines remain unless superseded. For other screens, use their approved screen-specific spec/reference.
4. Separate approved design, implemented capabilities, and the current task. Omit/reflow unsupported controls rather than inventing functionality. Do not infer pricing, extra roles, task completion, avatar uploads, or destructive actions from a mockup. Record material design discrepancies.

## Build within the existing frontend

- Work in `apps/frontend/src/features/` for feature UI, `src/app/` for routing/providers/layout, and existing `src/components/`/`src/hooks/`/`src/lib/` for reusable behavior. Follow the [frontend architecture](../../../docs/architecture/frontend-architecture.md), checked against actual source.
- Reuse `Brand`/`BrandLogo` from `apps/frontend/src/components/Brand.tsx`, official assets, and semantic tokens in `apps/frontend/src/style.css`. Preserve logo artwork and canonical Kanvexa indigo; do not copy conflicting screenshot colors or introduce competing primitives.
- Use existing REST clients, TanStack Query keys, and mutation patterns. Scope private data to the session and Board; handle stale requests, optimistic rollback, realtime invalidation/resync, logout, and access revocation. If a needed API is missing, identify the contract work instead of mocking successful business behavior.
- Support desktop, tablet, and mobile with intentional scrolling and reachable actions on short screens. Preserve the approved mobile drawer model and intentional horizontal Kanban scroll; avoid accidental page overflow.
- Use semantic controls, labels, visible focus, contrast, keyboard activation, Escape handling, focus trapping/restoration, and touch targets. Check keyboard alternatives for drag/drop where affected, reduced motion, and screen-reader announcements for important state changes.
- Cover loading, empty, error/retry, saving, disabled/permission, archived/read-only, and reconnect/conflict states relevant to the screen. Permission-disabled actions and unimplemented features are different states; UI visibility never replaces server authorization.
- Support Light/Dark/System when theming is in scope or already supported by the affected flow. Use semantic tokens, system changes, accessible contrast, persisted preference where supported, and initial-render defaults without theme flash. A stored theme preference alone does not prove app-wide theme support.

## Verify behavior and appearance

1. Run focused interaction/regression tests and relevant checks using [kanvexa-verification](../kanvexa-verification/SKILL.md).
2. Inspect the real rendered UI in an available browser; capture comparable screenshots against the approved reference. Target 375×812 mobile, 768×1024 tablet, 1280×800 laptop, and about 1440px desktop, plus breakpoints materially affected. Check supported themes, keyboard/focus, permission/read-only, loading/error, and long-content states relevant to the change.
3. Compare layout/hierarchy first, then typography, spacing, color, and component states. Check neighboring routes/shared components for regressions. Do not claim visual parity from a build or component test.
4. Store evidence under `docs/design/screens/implementation/` when required by the task, with task-record links following the [task index](../../../docs/tasks/README.md). Do not overwrite approved references or render mockup images as app UI.
5. Report implemented behavior, references used, deliberate deviations, actual visual/test results, and remaining risks. If browser tooling or required test data is unavailable, report visual QA as not run with the reason; do not require a particular external plugin.
