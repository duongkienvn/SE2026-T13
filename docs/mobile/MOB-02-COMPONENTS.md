# Mobile component foundation (MOB-02)

The UI layer in `apps/mobile/src/ui` is presentation only. It does not own routes,
sessions, server data, permissions, or mutation semantics. Import through `src/ui`.
The native system font is used so operating-system font scaling remains available;
no Inter font assets are bundled. The K mark is the byte-identical MOB-01 asset. `expo-system-ui` is included for automatic system appearance in native Android builds.

## Theme

`ThemeContext` accepts `light`, `dark`, or `system` (default). `useTheme()` resolves
system changes with React Native's color-scheme hook. `tokens.ts` exports semantic
palettes, typography, spacing, radius, elevation, and size constants. `typography.numeric` requests tabular numerals for counts and dates; native font support determines the actual glyphs. The caller owns preference
persistence and synchronization. Board-supplied label colors can be provided to
`Chip` as explicit foreground/background/border colors; callers must validate their
contrast. Board artwork is supplied as a React node rather than invented locally.

## Components

- `Button`: label, callback, variant, disabled, loading; the icon variant requires
  an icon element and an accessible action label.
- `TextField`, `SearchField`, `PasswordField`: native input props, label, error and
  hint and optional `leading`/`trailing` slots; field values are owned by the caller. Slot actions remain independently accessible. The password toggle keeps the value; use `showPasswordLabel` and `hidePasswordLabel` for localized toggle text.
- `AppHeader`, `ScreenHeader`, `SectionHeader`: visual composition with slots.
- `Avatar`, `AvatarStack`: names, optional image sources, initials fallback. Set `AvatarStack`'s `accessibilityLabel` to localize its count and names.
- `Chip` and aliases `LabelChip`, `DueChip`, `StatusChip`, `FilterChip`: label,
  optional selected/press and semantic tone; selected chips show a check mark as well as color.
- `Surface`, `ListRow`, `BoardRow`, `TaskRow`, `NotificationRow`, `BoardTile`,
  `CardPreview`, `StatTile`, `Separator`: composable content; consumers provide
  real strings, artwork, and callbacks. `ListRow` accepts an action-specific
  `accessibilityLabel`; its `trailing` slot is independent of the row action and
  owns its own disabled state and accessible label.
- `Skeleton`, `LoadingState`, `EmptyState`, `ErrorState`, `OfflineState`,
  `Snackbar`: presentation with caller-provided messages and actions. `Skeleton` accepts a localized `label` for assistive technology.
- `Checkbox`, `ProgressBar`: controlled checked state and determinate percentage; the caller supplies the label and authoritative value.
- `SegmentedControl`, `PreferenceSwitch`, `FormFooter`: controlled selection and
  actions. Selected segments also show a check mark; the consumer owns pending state and server confirmation.
- `BottomSheet`, `Dialog`, `ConfirmDialog`, `UnsavedChangesPrompt`: controlled
  visibility and dismissal; `onRequestClose` handles Android hardware Back. Set
  `dismissLabel` to localize the backdrop action. `UnsavedChangesPrompt` also
  accepts `title`, `message`, `discardLabel`, and `keepEditingLabel` overrides;
  the default copy is English.

Allow content to grow vertically at large font sizes. Use safe-area containers and
keyboard avoidance at the screen boundary; do not place fixed-height text or actions
behind system bars. Use accessible action labels and verify externally supplied
colors. Components have no knowledge of ACL or persistence.

## Handoff by reference group

These are composition starting points, not completed screens or a visual sign-off.
Follow-on work supplies real content, actions, authorization, navigation and any
feature-specific layouts from the current contracts.

| Reference                                                                    | Reusable pieces                                                                          | Follow-on composition                                                                     |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Home dashboard](assets/01-home-dashboard.png)                               | `AppHeader`, `ScreenHeader`, `StatTile`, `TaskRow`, `BoardRow`, `BoardTile`              | Place real summary data, artwork and actions; navigation belongs to MOB-03.               |
| [Boards and workspace switcher](assets/02-boards-and-workspace-switcher.png) | `BoardTile`, `BoardRow`, `BottomSheet`, `ListRow`                                        | Supply board artwork and accessible selection/actions from authorized data.               |
| [Board detail and filters](assets/03-board-detail-and-filters.png)           | `CardPreview`, chips, `AvatarStack`, `ProgressBar`, `BottomSheet`, `PreferenceSwitch`    | Compose columns and filter controls; use actual labels and counts.                        |
| [Card detail](assets/04-card-detail.png)                                     | `ScreenHeader`, chips, `AvatarStack`, `Surface`, `Checkbox`, `ProgressBar`, `FormFooter` | Provide checklist state, attachment/comment content and mutation behavior.                |
| [My Tasks](assets/05-my-tasks.png)                                           | `TaskRow`, `SectionHeader`, chips, `BottomSheet`, `Checkbox`                             | Compose groups and filters from actual task state; do not infer completion.               |
| [Inbox and preferences](assets/06-inbox-and-preferences.png)                 | `NotificationRow`, `Avatar`, `SectionHeader`, `PreferenceSwitch`                         | Supply notification text, read state and preference updates.                              |
| [Global search](assets/07-global-search.png)                                 | `SearchField`, `SegmentedControl`, `ListRow`, `BoardRow`, `BottomSheet`                  | Supply result and filter behavior; give slot actions their own labels.                    |
| [Calendar](assets/08-calendar.png)                                           | `ScreenHeader`, `SegmentedControl`, `TaskRow`, chips, `BottomSheet`, `Checkbox`          | Compose the calendar/date layout and filters from real dates and access.                  |
| [Authentication](assets/09-authentication.png)                               | `AppHeader`, `TextField`, `PasswordField`, `Button`, `Checkbox`, `MessageState`          | Supply authentication flows and validation; no session or navigation is implemented here. |
| [Profile and settings](assets/10-profile-and-settings.png)                   | `Avatar`, `ListRow`, `TextField`, `PreferenceSwitch`, `FormFooter`, `ConfirmDialog`      | Supply profile data and account actions; respect server capabilities.                     |

`ListRow` keeps its trailing action separate even when the row is disabled. Disable
that action independently when necessary. `ConfirmDialog` blocks confirm, cancel,
backdrop and Back while `loading`; the caller must set and clear pending state.
`ProgressBar` takes a percentage and clamps it to 0–100; provide visible progress
text separately when users need the exact value. `BottomSheet` and `Dialog` need
controlled `visible`, `title`, `onDismiss` and children; the caller owns the decision
to dismiss and must place screen-level content within safe areas.

## Gallery

The gallery is a separate Expo entry under `apps/mobile/gallery`; it is not imported
by the app bootstrap or registered as an Expo Router route. Its sample strings are
component fixtures only. It includes examples of label and due chips and a separator.
The pending-confirmation example blocks its controls for 20 seconds and then
unlocks; it simulates no business action. Android device observations are recorded below.
From `apps/mobile/gallery`, run:

```powershell
node ../node_modules/expo/bin/cli start --go
```

It needs an Android device/emulator or iOS simulator with Expo Go. Its own
TypeScript config extends the mobile config and prevents Expo from generating an
untracked config at startup. Metro startup and Android/iOS exports were checked;
that is not evidence of device appearance or interaction.
A partial Android review was performed on a Samsung Galaxy A50s; see the verification record below. iOS simulator is unavailable on Windows.

## Known differences and open verification

The approved PNGs contain generated placeholder logos in early screens: the official
blue–teal K replaces those placeholders as explicitly required by the design spec.
The Card Detail and Board references show checklist checkboxes and progress bars; generic controlled primitives provide those visual pieces without introducing checklist behavior. The approved light visual language informs the components; dark colors are semantic
adaptations, not inverted mockups. Password visibility uses a labelled text button
below the field instead of the reference eye icon, preserving a 48-point target and
an explicit accessible action; the password action was inspected in the gallery on the A50s. Selected chips and segments add a check mark so selection is not communicated by color alone. The gallery was compared with the approved references for basic branding, palette, controls and sheet treatment; it does not reproduce complete screen layouts. Automated component tests cover disabled/loading buttons, input and password value preservation, selection semantics, and the modal Back callback. Long localized names and every component variant were not exhaustively checked.

The approved Card Detail reference uses an indigo-to-teal progress fill. The generic `ProgressBar` requests a native React Native gradient with contrast-adjusted semantic endpoints rather than sampling exact colors from the image; its track is darkened in dark mode. This adjustment needs owner visual review. A solid primary background is supplied as a fallback.

### Light-palette accessibility variance

The implementation keeps the approved primary and app background. The following
foreground aliases differ from the spec's illustrative light values so small text
can meet 4.5:1 contrast on the surfaces used by the primitives. These are semantic
text/status roles, not replacements for API-provided Board label colors.

| Role           | Spec baseline | Implementation | Contrast on white, baseline → implementation |
| -------------- | ------------- | -------------- | -------------------------------------------- |
| Secondary text | `#5E6685`     | `#515A78`      | 5.65 → 6.81                                  |
| Muted text     | `#858CA8`     | `#626B89`      | 3.33 → 5.27                                  |
| Success        | `#109B81`     | `#087762`      | 3.48 → 5.49                                  |
| Warning        | `#F59E0B`     | `#865100`      | 2.15 → 6.58                                  |
| Danger         | `#EF4444`     | `#B42332`      | 3.76 → 6.51                                  |
| Info           | `#3B82F6`     | `#175CC4`      | 3.68 → 6.24                                  |

The decorative divider/border alias is `#D5D9E8` rather than the illustrative
`#E5E7F0`. Interactive field, button and checkbox boundaries use a separate
`controlBorder` role (`#7E849E` in light mode) to achieve at least 3:1 against
the relevant light surfaces. These adjustments are recorded for visual review. The updated input and secondary-button borders were inspected in light and dark gallery modes on the A50s; they do not constitute owner approval of other design changes.

## Verification record

- On 2026-11-10, the GitHub issue body matched the supplied acceptance criteria and had no comments. The local `main` and feature-branch merge base matched the remote `main` head at verification time.
- On 2026-11-11, a read-only `git ls-remote` recheck confirmed that local `main` and the feature-branch merge base still matched the remote `main` head.

- Standalone Android and iOS gallery entries exported through Metro/Hermes with the
  supplied K logo. Separate production Android and iOS exports passed the source-map
  audit that rejects gallery sources; a negative test verifies that rejection. These
  JavaScript exports are not native builds, renderings, or screenshots. After the
  native progress gradient was added, the gallery was exported again for both Android
  and iOS. The production entries were also re-exported and their source maps passed
  the isolation and logo audit on both platforms. These production entries do not
  exercise the gallery's progress bar. Temporary bundles were removed after verification.
- Mobile typechecking, the Metro/logo and theme tests, and twenty-two component tests
  passed. The component suite exercises controlled values and validation copy,
  selected/disabled/loading accessibility states, control-border use, checkbox changes, disabled preference-switch events, input slot actions and accessible progress/loading roles, rendered theme selection with a simulated system scheme, button and invalid-input focus, icon-action semantics, tabular numeral styling, avatar recovery after a source change and grouped count/name semantics, localized password, avatar-stack and skeleton labels, modal request-close handling, pending confirmation blocking Back, confirm, cancel and backdrop before restoring those actions, localized unsaved-prompt labels and discard/keep/Back callbacks, keyboard-avoidance configuration, and independent row actions.
- Token tests also check primary pressed text at 4.5:1, the focus color against surface, soft surface, and app background at 3:1, and five sampled progress-gradient colors against the track at 3:1 in both themes. A temporary component diagnostic passed the `ProgressBar` style through the installed React Native 0.88 background-image processor in both themes and received one linear gradient with two valid colors; the diagnostic was then removed. These checks do not establish contrast for every gradient point, arbitrary caller-provided colors, or every possible component combination.
- Root lint and build passed. The latest root `pnpm test`, with two Vitest workers, passed 20 shared, 1,283 backend, 1,677 frontend, and 27 mobile tests. The preceding root run failed one frontend test: `BoardNavigation.test.tsx` observed two `board:join` requests instead of one. That file passed all 18 tests in one separate run; subsequently the same assertion failed when the affected test was run alone with `--repeats 9`. Its cause remains unconfirmed and is not attributable solely to concurrent workspace tests; the latest pass does not establish that the issue is fixed. The inspected test, fake socket, and realtime client have no diff from local `main`. An earlier root run failed in the mobile component suite with two five-second timeouts and an unsaved-prompt callback assertion failure while packages ran concurrently; the mobile suite passed separately before and after that run. The component-test timeout was increased from five to 15 seconds before subsequent passing root runs; that does not prove the earlier assertion failure's cause or eliminate flakiness. Earlier, a root test run passed backend and mobile/shared tests but failed one frontend invitation resume assertion; that frontend file passed all 27 tests when rerun separately. Another root run with one Vitest worker had a mobile timeout, followed by a passing sequential workspace run. Another earlier run had an invitation focus assertion failure. The default root formatter reported
  existing CRLF checkout differences; `pnpm format:check --end-of-line auto` passed.
- A temporary diagnostic wrapper around the affected Web test reproduced the failure with `--repeats 49`. In the failing instrumented runs, the fake socket recorded `board:join`, `board:leave`, then a second `board:join`; the second join originated in `BoardRealtimeClient.reconcile`. The diagnostic was removed. This narrows investigation toward watcher/room lifecycle but does not establish the underlying trigger or production-server behavior.
- Samsung Galaxy A50s (SM-A507FN), Android 11, Expo Go SDK 58: at 450 dpi (approximately 384 dp wide) the initial light gallery, sheet input with keyboard, confirmation dialog and dark mode rendered. The keyboard did not cover the sheet's Close button; Android Back dismissed the keyboard and then the sheet. The initial dark render had unreadable dark status icons; the gallery now selects light status icons on dark background and this was verified on the device.
- On 2026-11-11, the added label-chip, due-chip, and separator gallery examples were inspected on the A50s in light and dark modes at 450 dpi (approximately 384 dp) and 110% font scale. Both chip labels and the separator were visible without horizontal clipping. At 540 dpi (320 dp) and 160% font in dark mode, the chips wrapped onto separate lines and remained readable, and the separator fit the available width. Density and font scale were restored to 450 dpi and 110%. This does not cover every component variant.
- At 450 dpi and 110% font on the A50s, the native `ProgressBar` displayed an indigo-to-teal fill from left to right in both light and dark gallery modes. This is not a pixel-match assessment or iOS verification. In the 20-second pending confirmation, Android's UI hierarchy reported Confirm as busy and disabled and Cancel as disabled; hardware Back kept the pending dialog open. After the pending period, Confirm became enabled and closed the example, and on a second run Back closed it after the pending period. This is a hierarchy and interaction check, not an audible TalkBack test.
- At 450 dpi (approximately 384 dp) and 130% font in dark mode, the A50s displayed the long selection and filter labels, checkbox, progress bar, switch, chips, separator and avatars without horizontal clipping. This is a focused sample, not all component variants. Font scale was restored to 110%.
- At 450 dpi (approximately 384 dp) and 100% font in dark mode, the A50s displayed the search and password fields, password toggle, long selection and filter labels, checkbox, progress bar and switch without horizontal clipping. This is a focused sample; the font scale was restored to 110%.
- At 320 dp and 160% font in dark mode, the A50s displayed both short examples and longer Vietnamese titles in `CardPreview`, `TaskRow`, and `NotificationRow` without horizontal clipping; the long row subtitles also wrapped. This does not verify interactive variants for those examples. Density and font scale were restored to 450 dpi and 110%.
- On the A50s dark gallery, switching to the second segment, enabling the preference switch, and revealing a sample password worked. Android's UI hierarchy exposed the segment as a checked radio button, the preference as a checked switch, and the password action as a labeled button. The preference switch measured 135 pixels at 450 dpi (48 dp). This is a semantic inspection, not an audible TalkBack test. The overlapping initials avatars and their combined count/name label were inspected at normal width and at 320 dp with 160% font. The `StatTile` value remained visible on the A50s with tabular numeral styling requested; glyph advance equality was not measured. After adding visible check marks, selecting the filter chip and second segment on the A50s showed the check marks and updated the controls; the selection examples were inspected at the device’s normal font and width.
- The gallery followed live Android system changes from dark to light and back to dark on the A50s with automatic appearance enabled; the original dark setting was restored. The checkbox toggled from unchecked to checked and the progress example appeared in Android accessibility hierarchy. At normal width, typing in the search example exposed a separate clear action, and activating it cleared the sample value. An invalid field showed the focus border while focused and returned to the error border after focus moved; its error text remained visible. At 320 dp and 160% font, the search input and clear action remained visible above the keyboard after the gallery hid its theme selector. The gallery unsaved-changes prompt rendered on the A50s at normal width; Discard, Keep editing and Android Back produced their respective fixture feedback. The gallery rendered at 160% font and 540 dpi (320 dp wide), including both settings together after restarting Expo Go. A long Vietnamese board-row title and subtitle wrapped without horizontal clipping, with the trailing action below the text. A long selected Vietnamese segment and filter chip also wrapped within their controls after adding chip padding. At the same narrow width and font scale in dark mode, the loading, empty, error and offline examples rendered legibly while scrolling; the snackbar and form action were visible at the end of the gallery. This does not verify every component or localization. Changing density and font while Expo Go was running produced an initialization error; restarting the app worked. Device settings were restored to the original 450 dpi override and 110% font scale.
- Device screenshots: [light](../design/screens/implementation/mob-02-design-system/a50s-light.png), [sheet and keyboard](../design/screens/implementation/mob-02-design-system/a50s-sheet-keyboard.png), [dark](../design/screens/implementation/mob-02-design-system/a50s-dark.png), [320 dp and 160% font, long selections](../design/screens/implementation/mob-02-design-system/a50s-font-160.png), [320 dp and 160% font, long row](../design/screens/implementation/mob-02-design-system/a50s-narrow-320dp.png). These are focused examples, not complete visual acceptance.
- Audible TalkBack was not tested at the user's request; Android accessibility hierarchy checks are described above. Native development-build rendering of automatic appearance, exhaustive component/state coverage, combined narrow/large-font behavior beyond the inspected examples, Pixel 8 and iOS are **not verified**. The iOS simulator is unavailable on this Windows host.
