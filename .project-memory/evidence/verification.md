# Verification evidence and smoke checklist

Status: Confirmed for revision `f464545` in the source environment used on 2026-07-31. Evidence: command results from the completed implementation turn and repository tests.

## Latest committed baseline

Status: Confirmed for `2ad1a8e` on 2026-08-04. Evidence: completed command results from the implementation turn before the current uncommitted Claude refactor.

- `npm test`: 184/184 passed.
- `npm run verify`: passed.
- `npm run build:free`: passed.
- `npm run build:sponsor`: passed.
- Both source builds emitted only the pre-existing font runtime-resolution and chunk-size warnings; no installer was generated.

## Uncommitted Claude compatibility/control completion

Status: Confirmed on 2026-08-05 for tests and structural verification. Evidence: command results in the implementation turn.

- `npm test`: 187/187 passed.
- `npm run verify`: passed; icon SHA-256 `84e4b2ddd07e751a19259a0e1956ae8267716137e760837fdb29f5d05ab2faac`.
- `npm run build:free`: attempted but sandboxed esbuild could not read the repository-parent path used to resolve Vite configuration. Escalated execution was unavailable because the local approval proxy returned `503`; no build result is claimed.
- `npm run build:sponsor`: not run after the identical build environment restriction was established.
- No installer or package command was run.

Automated results:

- `npm test`: 94/94 tests passed.
- `npm run verify`: passed; icon SHA-256 `84e4b2ddd07e751a19259a0e1956ae8267716137e760837fdb29f5d05ab2faac`.
- `npm run build:free`: passed.
- `npm run build:sponsor`: passed.
- Free and sponsor source editions both launched and closed successfully.
- A real local Codex App Server handshake passed for initialize, `thread/list`, and `thread/read`.

Required regression smoke checklist after related changes:

1. Refresh at least 25 times; pet remains clickable and the invisible window never blocks the desktop.
2. Open monitor card details, management layout/sensors/permissions pages, and custom window in sponsor mode.
3. Verify unavailable hardware has a specific explanation and real zero readings remain distinguishable from missing values.
4. Open a Codex task detail, feed repeated status snapshots, scroll/type/reply/approve, and confirm the page persists.
5. Verify badge and bubble events do not open Codex settings.
6. Confirm running/blocked/ready states have distinct pixel layers and physical motion, with grip point attached to rope.
7. Confirm free edition lacks the sponsor custom/developer entry while monitoring and Codex behavior match.

Installer validation is not included for this revision.

## Uncommitted Codex companion repair validation

Status: Confirmed for the working-tree repair on 2026-07-31. Evidence: changed source, expanded integration tests, source builds, and a real local-session diagnostic. This section does not assign a new Git revision.

- `npm test`: 108/108 tests passed.
- `npm run verify`: passed; icon SHA-256 `84e4b2ddd07e751a19259a0e1956ae8267716137e760837fdb29f5d05ab2faac`.
- `npm run build:free`: passed with only the existing font runtime-resolution and chunk-size warnings.
- `npm run build:sponsor`: passed with only the existing font runtime-resolution and chunk-size warnings.
- `node --test tests/codex-integration.test.mjs tests/codex-desktop-bridge.test.mjs`: 34/34 tests passed, including bounded one-line technical previews, desktop-mode connection-list visibility, zero-unread manual task opening and persistence, ignored direct-mode desired connections, and the invariant that desktop mode makes zero Monitor App Server factory calls.
- JavaScript syntax checks passed for `src/main/codex-monitor.js` and `src/renderer/codex-companion.js`.
- The latest `npm run build:sponsor` source build passed after the default-collapsed tool disclosure UI change.
- Both `npm run build:free` and `npm run build:sponsor` passed after desktop-compatible mode was isolated from Monitor's App Server and given the foreground-PID-verified client submit bridge.
- `tests/codex-desktop-bridge.test.mjs`: 4/4 tests passed for portable PowerShell resolution, ChatGPT/Codex process variants, foreground-first selection, 12/30-second slow-machine bounds, UTF-8 Base64 payload transfer, UIA button invocation with ordered shortcut fallbacks, fail-closed error handling, and timestamped local-session confirmation.
- Read-only inspection of installed Codex `26.721.4979.0` deep-link parsing confirmed that `codex://threads/{id}` locates a task without accepting a prompt, while prompt input is accepted only by the new-task route.
- A real local-session diagnostic classified the current task as `running`, found two running tasks, and bounded the session scan to 32 files / 50,176,443 bytes (about 47.9 MiB).
- Real same-task E2E passed through Monitor's renderer API and IPC path against task `019fb6cb-4219-7291-a94b-4cb79c9ba02a`: `MONITOR_E2E_20260731_170500 中文确认闭环` appeared intact in Codex and Monitor returned `submitted: true` with desktop process id `18032` after local-session confirmation.
- The restored/full-size Codex layout initially reproduced a focus migration failure after UIA text insertion. After removing the persistent-focus assumption, `MONITOR_E2E_20260731_174500 大屏焦点迁移闭环` appeared intact and returned `submitted: true`.
- After device-portability hardening, `MONITOR_E2E_20260731_180000 设备无关大屏回归` passed through the same task and returned `submitted: true`; the bridge used no screen coordinates, fixed PID, install path, localized window title, or compact-layout autofocus.
- Final full gates after the E2E repair: `npm test` 108/108 passed, `npm run verify` passed, and both free and sponsor source builds passed with only the existing font-resolution and chunk-size warnings.
- Final gates after adding persistent task-list navigation: `npm test` 108/108 passed, `npm run verify` passed, and free/sponsor source builds passed. Transparent-window screenshot capture was attempted twice for visual QA but Windows Graphics Capture returned `SetIsBorderRequired` unsupported; no UI input was performed by that failed visual probe.
- No installer was generated.
