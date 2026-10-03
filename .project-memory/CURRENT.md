# Current architecture

Status: Confirmed at `2ad1a8e`; the Claude compatibility/control completion is verified but uncommitted. Evidence: `manifest.json`, Git history, and affected tests.

## Runtime map

```text
Electron main (src/main/index.js)
├─ transparent-window lifecycle + soft refresh
├─ tiered Windows/GPU/hardware sampling
├─ persistent settings and edition-gated windows
├─ HardwareSensorHost client/elevation
└─ CodexMonitor: lifecycle Hooks + rollout JSONL + read-only SQLite discovery + direct App Server / foreground-verified client submit bridge
          │
          ▼ preload IPC (src/main/preload.js)
Renderer (src/renderer/main.js)
├─ Pixi pet/rope/physics/state machine
├─ dashboard cards, details, layout drafts, adaptive visuals
└─ Codex tray/bubbles/view state/grip-joint motion
```

## Navigation map

- Build and packaging: `package.json`, `scripts/build.mjs`, `scripts/package.mjs`, `electron-builder.config.js`.
- Edition contract: `contracts/editions.json`.
- Monitor data acquisition/normalization: `src/main/system-monitor.js`, `hardware-sensor-monitor.js`, `gpu-monitor.js`, `monitor-metrics.js`.
- Monitor UI/config: `src/renderer/dashboard-panel.js`, `dashboard-model.js`, `monitor-visuals.js`, `panel-layout.js`; config schema in `contracts/monitor-panel-config.schema.json`.
- Refresh and click-through protection: `src/main/window-lifecycle.js`, `src/renderer/input.js`, tests in `tests/window-lifecycle.test.mjs`.
- Codex integration: `src/main/codex-monitor.js`, `src/shared/codex-integration.js`, `src/renderer/codex-companion.js`, `codex-view-state.js`, `codex-motion.js`; state contract in `contracts/codex-state-machine.yaml`.
- Pet physics and skins: `src/renderer/physics.js`, `rope.js`, `state-machine.js`, `assets/skins/skins.json`.
- Native reader: `native/HardwareSensorHost`, bundled files and hash manifest in `resources/hardware-sensor`.
- Tests: `tests/*.test.mjs`; project gate: `scripts/verify-project.mjs`.

## Latest completed slice

Status: Confirmed. Evidence: Git commit `2ad1a8e`, `tests/codex-integration.test.mjs`, `tests/claude-integration.test.mjs`, and `tests/mouse-passthrough.test.mjs`.

The current head provides shared Codex/Claude task surfaces with direct replies, client-compatible handoff, direct-only bypass controls, tool-request approval, turn interruption, per-session reasoning controls, stable task-detail rendering, and transparent-window hit-region coordination. Codex reasoning values are discovered from App Server `model/list` and passed as `turn/start.effort`; client-compatible mode preserves the native client configuration.

## Uncommitted working-tree slice

Status: Confirmed in the uncommitted working tree. Evidence: `src/main/claude-client-bridge.js`, `src/main/claude-monitor.js`, `src/main/index.js`, `src/main/preload.js`, `src/renderer/codex-companion.js`, and integration tests.

Claude session preferences migrate from `custom` to `adaptive` and always retain an independent bounded effort. The shared conversation controls render the effort as a discrete slider for Codex and Claude; Claude keeps its thinking mode alongside it, while Codex has an explicit follow-configuration choice. The peak effort tier has a contained visual emphasis that respects reduced-motion preferences.

Claude desktop-compatible sending resolves the newest usable VS Code-family IDE lock even when workspace matching is stale, focuses a UI Automation `Document` or `Edit` composer in the verified client process, then pastes and submits with Enter/Ctrl+Enter fallback. Session-owner metadata retains titles even after its process exits, while a task is treated as externally running only when the owner is alive with an active status. Monitor-managed Claude turns and pending approvals expose the provider-neutral stop action through Claude IPC.

## Codex Desktop live activity signals

Status: Confirmed in the uncommitted working tree. Evidence: `.project-memory/contracts/codex-state-machine.yaml`, `src/main/codex-hooks.mjs`, `src/main/codex-state-db.mjs`, `src/main/codex-monitor.js`, and the targeted Codex tests.

Codex lifecycle Hooks report prompt, tool, permission, interrupt, and stop events. Prompt and permission boundary Hooks write synchronously; high-frequency tool events remain asynchronous. The local event writer stores only session/turn identifiers, event name, and Hook-start time. Same-millisecond events have a deterministic lifecycle order, so a completed `PostToolUse` resolves a permission wait regardless of file enumeration order. `state_5.sqlite` is read-only and supplies rollout discovery/prioritization only; recency does not establish active or completed status. The latest prompt turn id filters delayed events from old turns; same-turn Interrupt outranks Stop, and terminal Hook evidence outranks delayed tool events. Hook review/trust remains a Codex-side step. Abrupt exits without terminal Hook or rollout evidence remain ambiguous; no idle timeout is used to invent completion.

## Subscription integration

Status: Confirmed in the working tree and deployed service. Evidence: `subscription-service/src/worker.js`, `subscription-service/migrations/0002_skin_library.sql`, `src/main/subscription-runtime.js`, `src/main/skin-publisher.js`, `src/renderer/skin-selector.js`, `tests/skin-publisher.test.mjs`, and recent `npm test` / `npm run verify` results.

The public Worker, D1, and R2 bucket are deployed at `https://licensemonitor.b100.top`. The client presents a copyable Afdian order binding code, retrieves the public online skin catalog, and installs entitlement-protected `.skinpack` downloads only after package and per-file SHA-256 verification. The service exposes public catalog and preview endpoints while requiring a device proof carrying `skins` or `creator` entitlement for package download.

The authoritative subscription price ladder is `src/shared/subscription-model.js`: skin monthly `1`, skin yearly `9.8`, creator monthly `4.2`, creator quarterly `7.7`, and creator yearly `24.5` CNY. The Worker mirrors these as cents in `subscription-service/src/core.js` and was deployed with the updated strict amount validation.

The developer skin publisher validates a source directory, writes a built-in skin into `assets/skins`, prepares a gzip-compressed `.skinpack`, and can publish it with the locally authenticated Wrangler CLI. Publishing uploads the manifest, preview, and package to R2, then performs an idempotent remote D1 upsert into `skin_releases`; no Cloudflare credential is stored in the app or repository. A non-creator buyer end-to-end order refresh remains unverified.

The publisher is a separate developer-only Electron entry under `tools/skin-publisher`. The main app no longer exposes publisher IPC, menu entries, source files, or build-copy steps. Main installers include only `.vite`, runtime assets, and subscription configuration; the publisher has its own `skin-publisher` start and portable-package commands.

## Custom editor import workflows

Status: Confirmed in the working tree. Evidence: `src/custom/custom.js`, `src/custom/index.html`, `src/custom/preload.js`, `src/main/index.js`, and `tests/custom-mode-ui.test.mjs`.

The pixel canvas accepts PNG files through `canvasImportBtn`/`canvasImportInput`. Square images using a supported canvas size keep their native grid; other images are nearest-neighbor adapted to the selected canvas size. The imported grid is placed in the normal canvas history, so drawing, undo, export, and expression handoff continue to work.

The expression editor has a shared skin-frame loader. Current skin loading, skin-library import completion, and each skin-library card's `编辑` action load resolved frames into `exprData`, refresh thumbnails, switch to the expression tab, and select the first available state. The main-process `skin-get-frames` IPC resolves both built-in ASAR skins and user skins without changing the active skin.

The cross-machine Agent runbook is [../DEVELOPER-SKIN-PUBLISHER.md](../DEVELOPER-SKIN-PUBLISHER.md). It documents local Wrangler configuration, `TURTLE_SKIN_REPOSITORY`, source and portable startup, release steps, catalog verification, and common failures.
