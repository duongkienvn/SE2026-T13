# P5-06 Keyboard Shortcuts, Accessibility & Performance (DX-03)

The dedicated `/settings/keyboard-shortcuts` page follows Data & Privacy in
Settings. It documents the approved keys, their scope and the platform-specific
Ctrl or ⌘ search key; the mockup's create, edit, archive, delete and refresh
examples are excluded. The existing Search handler owns Ctrl/Cmd+K and existing
dialog/inspector handlers own Escape. No additional shortcut modal is created.

Outside editors, composition and open overlays, `?` opens this Settings page.
`G` then `H`, `T` or `B` within one second opens Home, My Tasks or Boards.
On an authorized mounted Board, `1`, `2` and `3` select Board, Calendar and
Table while retaining filter parameters. `J` and `K` focus the next or previous
visible Card without wrapping; from outside the collection they start at its
first or last Card. Enter opens the focused Card through the existing route.
Calendar uses the Card permalink route and returns to the Calendar context.
Closed disclosures, hidden or disabled Cards, active drags and overlays are
excluded. Navigation and keyboard listeners are removed on session unmount.

Nested dialogs retain the topmost focus trap, background inertness and Escape
handling. IME composition does not dismiss a dialog. The keyboard handler uses
the existing auth/Board render boundary and does not request or mutate Card
data. No dependency, API, schema or Socket.IO protocol was added.

## Verification and limitations

`pnpm test` passed with workspace concurrency set to one and local loopback
access: shared 20 tests, backend 114 suites / 1,261 tests, frontend 145 files /
1,514 tests before the final Card picker fixes. The full frontend suite was
then rerun on the final code and passed 145 files / 1,516 tests. The focused Board, Settings,
Search and dialog run passed 80 tests; the later focused shortcuts run passed
55 tests. After the picker fixes, Card Actions, Labels and Dialog suites passed
32 tests, frontend build and `pnpm lint` passed. The workspace build
passed before that final fix. `pnpm format:check` reported 1,109 files with
formatting issues; changed files are checked separately.

The focused integration suites exercise the Settings route and active rail,
G chords and timeout, modifiers, editable fields, IME, overlays, permission
loss, J/K focus, Calendar Card Detail, the three Board routes and filter/photo
continuity. Existing Search tests cover Ctrl/Cmd+K. Nested dialog tests cover
Escape, focus restoration and IME. These are component tests with mocked API
responses rather than real account/session revocation tests.

Chrome headless QA used synthetic session, API and realtime responses. It
exercised J/K, Enter and Escape on Table/Card Detail, view switching with a
filter, G–T, `?`, Ctrl+K, Search Escape/focus restoration and the page heading
in Chrome's accessibility tree. It does not replace a full screen-reader or
assistive-technology audit. Focused tests cover Escape in the inline assignee
picker and label editing; pending label mutations are not dismissed.
The label picker focuses its search on opening and return from editing; its
delete confirmation focuses the safe choice, so Escape reaches the active
picker before Card Detail. The Card Labels suite passed 10 tests after this
focus fix.
Desktop
1586×992, tablet 768×1024 and mobile
375×812 dark/light [captures](../../design/screens/implementation/p5-keyboard-shortcuts/)
compare the approved composition with only the supported rows.

For a synthetic Board, 100 unrelated key events caused 100 Card collection
queries before the guard and zero after it. The measured elapsed times were
17.4 ms and 18.3 ms in single runs, so no speedup is claimed from that noisy
timing. The new handler registers one keydown listener per mounted session and
removes it on cleanup; existing Search and dialog listeners remain separate.
No wider render, network or runtime performance claim is made.
