# Semantic change log

## 2026-07-31 - Active-task reply and complete message repair

Status: Confirmed in the uncommitted working tree. Evidence: `tests/codex-integration.test.mjs`, source builds, and local-session diagnostic.

- Running tasks now recover a real App Server active turn id and use `turn/steer`; unresolved active turns stay temporarily read-only and retry automatically.
- App Server activity is authoritative over stale local rollout state, while second-based timestamps are normalized before comparison.
- Task details live-refresh, preserve visible errors, distinguish user/assistant/tool roles, and retain tool calls, tool results, and final assistant output.
- Tool calls and results default to a one-line disclosure with a bounded preview; keyboard or pointer activation reveals the complete content, and expansion survives background refreshes.
- Added a persisted reply-transport setting: `direct` sends through Monitor's managed App Server; `desktop` keeps the connection list visible but never starts a second App Server, opens the exact Codex desktop task, verifies the foreground Codex PID around paste/Enter, and submits through the client-owned UI channel.
- Corrected the earlier false-unification design after a local diagnostic proved that a second App Server could create a parallel turn under the same thread id without joining the desktop task's live context.
- Added a fail-closed Windows desktop bridge: navigation/focus/submit errors preserve the draft and surface an error rather than reporting success.
- The final desktop bridge targets the installed `ChatGPT.exe` window titled `ChatGPT` or `Codex`, activates it by PID, verifies the foreground PID and focused ProseMirror composer, transfers the message as UTF-8 Base64, confirms exact UIA `ValuePattern` readback, and invokes the composer send button.
- Enter and Ctrl+Enter remain ordered fallbacks only when the client exposes no invokable send button; the second shortcut runs only if the composer still contains text, preventing double sends across user shortcut settings.
- Desktop-mode success now also requires the local Codex session log to record a new matching user message; confirmation tolerates delayed log flushes instead of reporting a successful client send as failed.
- Desktop mode ignores persisted direct-mode desired connections when calculating connection state, so it no longer displays a false `connecting` state or starts a Monitor App Server.
- Removed the compact-window dependency from desktop submission: the bridge now discovers and focuses the composer from the active UIA window tree, then tolerates focus moving to another control in the same verified Codex process before button invocation.
- Hardened supported-Windows portability with ChatGPT/Codex process-name variants, foreground-first multi-window selection, longer slow-machine discovery deadlines, accessible-name send-button matching, and no screen-coordinate, DPI, localized-window-title, install-path, or fixed-PID assumptions.
- Changed the left-click Codex configuration list into `Tasks and conversations`: the task title/status area is now a native navigation button that opens the existing conversation detail regardless of unread count, while the right-side direct connect/disconnect or desktop `Open Codex` action remains independent.
- Initial rollout discovery is bounded to recent and selected files, and large files are tailed to avoid the previous full-history startup read.
- Preserved free/sponsor parity and generated no installer.

Record only changes that affect rebuilding, behavior, integration, or architecture.

## 2026-07-31 — Codex companion integration rebuilt

Status: Confirmed. Evidence: commit `f464545`, `tests/codex-integration.test.mjs`.

- Added versioned Codex integration state, task grouping, per-task connection ownership, incremental log synchronization, long-lived App Server use, persistent detail view state, paged messages, exact task deep links, and real grip-joint state motion.
- Preserved free/sponsor monitoring and Codex parity and did not generate installers.

## Earlier stabilization baseline

Status: Confirmed. Evidence: Git history through `c46053d` and existing tests.

- Stabilized transparent-window soft refresh/click-through, monitor dashboard configuration/details, data-source reasoning, elevated sensor-host startup, tiered sampling, and dual-edition source builds.
