# Mobile testing and local Android builds

Install from the repository root with `pnpm install --frozen-lockfile`. Build
shared first when running mobile commands directly:

```powershell
pnpm --filter @kanban/shared build
pnpm --filter @kanban/mobile lint
pnpm --filter @kanban/mobile typecheck
pnpm test:mobile
pnpm bundle:mobile
```

Jest Expo and React Native Testing Library use the pinned Expo/React Native
versions. `test/render-native.js` supplies theme and safe-area metrics. Existing
component and Router tests cover accessibility, error/loading/disabled states,
keyboard, sheets, Back, malformed links and fail-closed navigation. The typed
`test/auth/support.ts` and `test/query/support.ts` provide fake clock, storage,
session and MOB-04 transport/data boundaries. `test/fixtures/native-lifecycle.ts`
drives the actual network and AppState interfaces without native hardware.
Fixtures are test-only and never supply runtime business data. Existing tests
mock native modules at their consumption boundaries. A Socket.IO mobile client
does not exist yet; MOB-06 owns its eventual integration tests.

The unchanged CI `Quality checks` job uses a frozen install and root lint, test,
build, infrastructure and formatting gates. Mobile's workspace build includes
typecheck and Android Metro export; no Android SDK or EAS cloud build is needed
on the runner. CD's separately owned mobile-only path filtering remains in place;
mixed changes still trigger it. JS export does not demonstrate an installable app.

For a local standalone APK, install JDK 17 and Android SDK tools as described in
[development.md](development.md). In PowerShell start an emulator with
`emulator -list-avds` and `emulator -avd <name>`, then check `adb devices`.
With the required SDK packages installed:

The current native graph requires Platform 37.0, Build-Tools 37.0.0 and 36.0.0,
NDK 27.1.12297006 and CMake 3.22.1. Native dependencies also use Platform 36.
Use a short checkout path without spaces for Windows native builds. This
repository's long Windows path hit Hermes command quoting and CMake/Ninja's
260-character object-path limit; a drive alias alone did not resolve pnpm's
physical paths. These are native build limitations, independent of Metro tests.

```powershell
pnpm --filter @kanban/shared build
pnpm --filter @kanban/mobile exec expo prebuild --platform android
Push-Location apps/mobile/android
./gradlew.bat assembleRelease
Pop-Location
New-Item -ItemType Directory -Force apps/mobile/apk | Out-Null
Copy-Item apps/mobile/android/app/build/outputs/apk/release/app-release.apk apps/mobile/apk/kanvexa-mob07-preview.apk
adb install -r apps/mobile/apk/kanvexa-mob07-preview.apk
```

Inspect the generated signing config: debug signing is for local testing only.
Generated native files and APKs are ignored. Keep `EXPO_PUBLIC_NAVIGATION_PREVIEW`
unset for acceptance so session guards remain enabled; public variables must
never contain credentials. Use a designated non-production service or no API.
Stop Metro before checking launch, navigation, Back, keyboard, safe areas and
logcat. Expo Go and debug builds generally need Metro; the release APK embeds JS.
EAS profiles are configuration only and do not authorize cloud builds or store
submission. iOS native builds and simulator tests require macOS and Xcode.

For this MOB-07 acceptance run, the owner separately authorized one EAS cloud
preview build after local Windows builds failed. The uploaded source came from
commit `c3eb7a8`; staging changed only the preview build configuration to select
the `preview` environment, force navigation preview to `0`, and use
`https://example.invalid/api` / `https://example.invalid` as non-production
public URLs. No fixture data or authentication bypass was added.
The archive retained the pnpm workspace/shared package and excluded generated
native projects, node_modules, environment files and local caches.

```powershell
# Run from apps/mobile after reviewing the archive and public environment.
npx --yes eas-cli@27.7.2 build --platform android --profile preview --non-interactive --freeze-credentials --no-wait
```

`--freeze-credentials` used the existing development application keystore;
there was no credential creation or store submission. A cloud build still needs
explicit authorization for future runs. The build record is linked in the
[MOB-07 verification record](../tasks/frontend/mob-07-mobile-testing.md).
