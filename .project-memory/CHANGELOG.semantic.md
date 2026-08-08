# Semantic change log

## 2026-08-08 - Subscription service and online skin delivery

Status: Confirmed in the working tree and deployed Cloudflare service. Evidence: `subscription-service/`, `src/main/subscription-runtime.js`, `src/main/skin-publisher.js`, `src/renderer/skin-selector.js`, `tests/skin-publisher.test.mjs`, `npm test`, and `npm run verify`.

- Added the Afdian-backed Worker and D1 subscription service with device-bound Ed25519 entitlement envelopes and copyable order-binding codes.
- Bound the `turtle-monitor-skins` R2 bucket and added a release catalog table. Public catalog/preview access is separated from device-proof-gated package downloads that accept either `skins` or `creator` access.
- Added client-side catalog loading, entitlement-bound download, gzip package parsing, manifest and frame checksum verification, atomic installation, and skin-list reload.
- Added the developer publisher for validating source skins, writing built-in skins, and preparing online `.skinpack` release artifacts. Automated R2/D1 publication and a real buyer skin-install E2E remain open.
- The developer publisher now uploads the release manifest, preview, and package through the machine's logged-in Wrangler CLI and upserts the published D1 release record. It keeps credentials outside the desktop application and repository.
- Moved the publisher into `tools/skin-publisher` with independent source/start/package commands. The Turtle Monitor build no longer copies publisher UI files or exposes publisher IPC; the portable developer tool is configured separately with `TURTLE_SKIN_REPOSITORY` and local Wrangler credentials.
- Added the root-level `DEVELOPER-SKIN-PUBLISHER.md` runbook and linked it from the handoff, build guide, next-window prompt, and project-memory bootstrap so another developer Agent can operate the tool without relying on conversation history.

## 2026-08-05 - Inline approval promotion

Status: Confirmed in the uncommitted working tree. Evidence: `src/renderer/codex-view-state.js`, `tests/codex-integration.test.mjs`, `npm test`, and `npm run verify`.

- An open Codex or Claude task detail now promotes a newly pending, supported approval or question from that same provider-scoped thread immediately. The composer and stop action are replaced by the actionable controls without requiring a window reload.
- Ordinary alerts and alerts from other threads still do not replace a conversation the user is reading.

## 2026-08-05 - Transparent pet hit testing stabilization

Status: Confirmed in the uncommitted working tree. Evidence: `src/renderer/main.js`, `src/renderer/input.js`, `tests/codex-integration.test.mjs`, `npm test`, and `npm run verify`.

- The pet, transparent-window gate, click-outside handler, and gesture manager now use the same visible body bounds with a forgiving edge, rather than mixing the texture container with the visible body.
- While the transparent Electron window is click-through, the renderer samples the system cursor at a bounded cadence and switches to capture as the pointer enters the pet. The poll is single-flight and is cleared on renderer unload, removing the event-delivery gap that previously made initial clicks and drags intermittent.

## 2026-08-05 - Claude compatibility, lifecycle, and reasoning controls

Status: Confirmed in the uncommitted working tree. Evidence: `tests/claude-integration.test.mjs`, `tests/codex-integration.test.mjs`, `npm test`, and `npm run verify`.

- Claude config is being moved from version 3 to 4. The legacy per-session `custom` thinking value normalizes to `adaptive`; session preferences continue to retain a bounded effort value.
- Direct Claude replies now append `--effort` for every selected session preference, while gateway compatibility still disables thinking where required.
- Claude client-compatible VS Code submission now discovers a UI Automation `Document`/`Edit` composer after deep-link navigation, verifies the foreground process rather than a transient window handle, and supports both Enter and Ctrl+Enter.
- Transcript titles prefer a user custom title over later AI-generated titles. Owner metadata keeps title information when its process is gone, but running status requires a live owner with an active status so stale sessions do not show as running.
- Codex and Claude share a discrete effort slider. Claude's thinking mode and effort are parallel controls; Codex retains a separate follow-configuration selection. The top effort tier has an accessible, reduced-motion-aware visual emphasis.
- Claude Monitor now exposes interruption for Monitor-owned turns and pending approvals through main-process IPC; the common renderer stop button calls the active provider rather than assuming Codex.

## 2026-08-04 - Shared agent controls and reasoning settings

Status: Confirmed. Evidence: commit `2ad1a8e`, `tests/codex-integration.test.mjs`, `tests/claude-integration.test.mjs`, and `tests/mouse-passthrough.test.mjs`.

- Codex and Claude share provider-scoped task controls for replies, approvals, direct-only bypass, configured send shortcuts, and interruption.
- Direct-mode Codex uses App Server approvals and can interrupt owned turns; pending approval items remain actionable until resolved.
- Codex and Claude session settings persist independently. Codex gets an effort override for direct turns, obtained from App Server model capabilities; desktop-compatible mode leaves the native client responsible for settings.
- The renderer uses provider-scoped conversation identities so a Codex and Claude session with the same source id cannot render into each other's detail surface.
- Mouse passthrough is coordinated across pet and companion hit regions so idle desktop space remains click-through while active interaction surfaces capture input.

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
