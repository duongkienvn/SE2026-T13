# MOB-01 — Expo bootstrap, pnpm/Metro compatibility and native environment

## Scope and baseline

Implemented in the existing checkout on `feat/mobile-expo-foundation`, starting
from `51a7962`. The three supplied mobile specifications and eleven approved PNGs
were already staged when work started. They are preserved as the design baseline;
Markdown received repository Prettier formatting, with no product scope changes.

Requirements: [MOB-01](../../mobile/KANVEXA_MOBILE_ROADMAP.md#mob-01--expo-app-bootstrap-pnpmmetro-compatibility-and-native-environment),
[Architecture §§2–3, 14](../../mobile/KANVEXA_MOBILE_ARCHITECTURE.md), and
[Design Spec brand/tokens](../../mobile/KANVEXA_MOBILE_DESIGN_SPEC.md).

The broader architecture's foundation spike also describes network requests and
tab/auth shells. Those belong to later issues and are excluded by the explicit
MOB-01 brief. No auth, transport, business screens, deep-link routing, design
system library, EAS profiles, store builds or production changes are included.
Historical architecture/roadmap planning statements are not deployment evidence.

## Implementation

- `apps/mobile` is a private `@kanban/mobile` workspace with Expo Router's
  `src/app` entry, strict TypeScript, Expo's default Metro config, explicit
  development/native/bundle scripts and the pinned SDK dependency matrix.
- Expo **58.0.23**, React Native **0.88.1**, React **19.3.0**, Router **58.0.30**,
  Expo Metro **58.0.0** / underlying Metro **0.87.1**. Mobile TypeScript **6.0.3**
  follows the official template; Web/backend/shared remain on **5.9.3**. Full
  direct dependency versions are in the [development guide](../../mobile/development.md).
- A single static route shows the original transparent logo, “Kanvexa” and
  “Mobile foundation”, using the approved light palette, native text, safe areas
  and a scrollable container for small/large-text layouts. There are no controls,
  sample entities/counts, API calls or tab/navigation screens. The PNG is copied
  byte for byte from the approved asset pack. No Web component or CSS is imported.
- Shared compatibility is checked at bootstrap by importing `BoardRole.MEMBER`
  and its type. This is a package-loading check, not a role/session assignment.
- Root mobile wrappers build shared before invoking Expo. Existing `pnpm dev`
  retains its Web/backend filters. Mobile's `build` is TypeScript checking only;
  bundle exports and native compilation are explicit commands. Root recursive
  tests include the deterministic Node/Metro smoke, without a new test framework.
- Native output, Expo state, signing material and generated platform directories
  are ignored by Git; generated native/state files are excluded from ESLint and
  Prettier. No global pnpm linker or shared export changes were necessary.
- Local public endpoint examples distinguish emulator, physical LAN and USB
  host mapping. The app does not consume them yet. Development identifiers are
  `tech.kanvexa.mobile.dev` / `kanvexa-dev`; release identifiers remain a later gate.

## Shared compatibility evidence

1. `tsc --noEmit` with Expo's bundler-resolution configuration compiles both the
   application import and a fixture consuming `ApiSuccessResponse<BoardRole>`.
   Metro's TypeScript transform erases types; type correctness is proven by tsc.
2. The Metro smoke uses the actual `metro.config.cjs`, Android resolution, a real
   bundle and its source map. It checks the existing `dist/esm/index.js` and enum
   path, rejects shared-source/CJS aliases and Web/backend imports, then evaluates
   emitted JavaScript in a Node VM and asserts `MEMBER`. Only native startup
   premodules are omitted for this pure-contract fixture, since it is not a device.
3. Full native bundle scripts audit the actual application maps for compiled
   shared ESM, absence of Web/backend/DOM implementations and Node shims, and
   byte-identical exported logo data. Native framework polyfills are legitimate
   runtime modules; a plain text search for `window` would not establish a Web
   dependency. App source uses no DOM, browser storage, `window` or Node APIs.
4. Existing shared tests exercise both Node ESM and CJS exports. No source or
   package manifest under `packages/shared`, `apps/frontend` or `apps/backend`
   changed. The lockfile adds native dependencies; pnpm also binds Vite's existing
   optional React compiler peer, without changing its version or enabling the
   compiler (`react()` has no compiler option in the existing Vite config).

## Verification — 2026-11-08, Windows

Environment: Node **22.17.0**, pnpm **10.18.3**. Existing CI uses Node **22.13.0**,
which satisfies the pinned Expo/RN engines; a Linux CI run was not triggered.

| Check                                                                 | Result                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Fresh manifest-only workspace, `pnpm install --frozen-lockfile`       | **PASS**; fresh root/package dependency directories, all five workspace manifests and committed lockfile      |
| `pnpm --filter @kanban/mobile exec expo install --check`              | **PASS**, dependencies up to date                                                                             |
| `pnpm --filter @kanban/mobile exec expo config --type public`         | **PASS**, SDK 58 and local development identifiers                                                            |
| `pnpm --filter @kanban/mobile typecheck`                              | **PASS**                                                                                                      |
| `pnpm test:mobile`                                                    | **PASS**, 2 tests: real Metro shared-runtime evaluation and logo identity                                     |
| `pnpm lint`                                                           | **PASS**                                                                                                      |
| `pnpm test` with `VITEST_MAX_WORKERS=2`                               | **PASS**, backend 1,283 / frontend 1,677 / shared 20 / mobile 2 tests; 2,982 total                            |
| `pnpm build`                                                          | **PASS**, shared/Web/backend builds and mobile type checking                                                  |
| `pnpm test:infra`                                                     | **PASS**, 22 tests; CI/CD safety contracts unchanged                                                          |
| `pnpm bundle:mobile` / mobile `bundle:android`                        | **PASS**, Android production export + graph/asset audit, 1,138 native sources                                 |
| `pnpm --filter @kanban/mobile bundle:development`                     | **PASS**, Android development export + graph/asset audit, 1,306 native sources                                |
| `pnpm --filter @kanban/mobile bundle:ios`                             | **PASS**, iOS JS/Hermes export + graph/asset audit, 1,146 native sources; not an Xcode build                  |
| `pnpm --filter @kanban/mobile dev --localhost --port 8083`            | **PASS**, Expo Go Metro startup; local `/status` responds `packager-status:running`; server stopped afterward |
| `pnpm format:check`                                                   | **FAIL**, 1,289 existing CRLF files in this Windows checkout; see line-ending note below                      |
| `pnpm format:check --end-of-line auto`                                | **PASS**, full repository formatting accepting checkout line endings                                          |
| Changed-file Prettier check, local Markdown paths, `git diff --check` | **PASS**, 147 local documentation paths verified; no whitespace errors                                        |
| Android boot / cold start / Fast Refresh / screenshot / TalkBack      | **NOT RUN**: no Android SDK, adb, emulator or attached Android device on this machine                         |
| Native Android Gradle compilation                                     | **NOT RUN**: Android toolchain absent                                                                         |
| iOS native build/simulator/physical device                            | **NOT RUN**: Windows host, no Xcode/Apple credentials                                                         |
| PostgreSQL integration, container image/smoke and production checks   | **NOT RUN**: no database/infrastructure changes; outside this task                                            |

Execution notes:

- The first root test attempt under concurrent cold-install/export load had 28
  frontend failures, primarily test timeouts. The repeat bounds Vitest workers
  using its existing environment override, without modifying tests/timeouts/CI.
- A first offline clean install could not fetch an uncached existing AWS SDK
  tarball; the online frozen-lockfile install completed. pnpm reports ignored
  `argon2` / `@scarf/scarf` install scripts under its existing policy; no global
  build-script approval or policy change was made.
- A first iOS export overlapped a shared rebuild and saw a missing shared `dist`
  file. Exports must run after shared builds; the guide documents this boundary.
- The Web build emitted its existing large-chunk warning and a warning about the
  local `NODE_ENV` setting. Local environment files were not changed or committed.
- Git reports `core.autocrlf=true` and `i/lf w/crlf` for untouched Web/shared
  files. Prettier's default LF check flags those existing checkout line endings;
  the full check with `--end-of-line auto` passes. Unrelated files and formatter
  policy were preserved. Changed files are formatted with the repository default.

## Changed files

| Area                | Files                                                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile app/config   | `apps/mobile/package.json`, `app.config.ts`, `tsconfig.json`, `metro.config.cjs`, `src/app/_layout.tsx`, `src/app/index.tsx`, `src/bootstrap/shared-compatibility.ts`, `src/types/assets.d.ts`, `assets/brand/kanvexa-logo-v1.png` |
| Mobile checks       | `apps/mobile/test/shared-metro.test.mjs`, `test/fixtures/shared-entry.ts`, `scripts/verify-native-bundle.mjs`                                                                                                                      |
| Environment/help    | `apps/mobile/.env.example`, `apps/mobile/README.md`, `docs/mobile/development.md`                                                                                                                                                  |
| Root tooling        | `package.json`, `pnpm-lock.yaml`, `eslint.config.mjs`, `.gitignore`, `.prettierignore`                                                                                                                                             |
| Documentation/index | `README.md`, `docs/tasks/README.md`, this record                                                                                                                                                                                   |
| Supplied baseline   | `docs/mobile/KANVEXA_MOBILE_ARCHITECTURE.md`, `KANVEXA_MOBILE_DESIGN_SPEC.md`, `KANVEXA_MOBILE_ROADMAP.md`, all eleven supplied PNGs in `docs/mobile/assets/`                                                                      |

## CI and production boundary

The existing quality job's frozen install, lint/test/build/infra/format commands
remain applicable. Mobile adds type checking and the shared Metro smoke to those
recursive gates, without adding cloud builds, signing, deployment jobs or new
permissions. CI/CD workflows, Dockerfiles, Compose and production configuration
are unchanged. Their explicit Docker COPY/filter boundaries exclude mobile code
from built Web/backend images; actual container builds were not claimed here.

## Remaining native acceptance

Use the [Windows/Android guide](../../mobile/development.md) to install compatible
Expo Go/tooling and run `pnpm dev:mobile:android`. On an emulator and physical
Android device verify boot, cold start, Fast Refresh, large text, safe areas and
TalkBack. Capture actual UI under
`docs/design/screens/implementation/mob-01-expo-foundation/` and link the evidence
here. No screenshot is fabricated and MOB-01's device acceptance is still open.

iOS device/Xcode validation, opaque/adaptive platform icon exports, production
bundle IDs, signing and EAS/store setup remain later native gates. No application
was pushed, published, deployed or tested against production.
