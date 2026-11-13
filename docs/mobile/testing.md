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
