# Current architecture

Status: Confirmed at `2ad1a8e`; the Claude compatibility/control completion is verified but uncommitted. Evidence: `manifest.json`, Git history, and affected tests.

## Runtime map

```text
Electron main (src/main/index.js)
├─ transparent-window lifecycle + soft refresh
├─ tiered Windows/GPU/hardware sampling
├─ persistent settings and edition-gated windows
├─ HardwareSensorHost client/elevation
└─ CodexMonitor: incremental logs + direct App Server / foreground-verified client submit bridge
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

## Subscription integration

Status: Confirmed in the working tree and deployed service. Evidence: `subscription-service/src/worker.js`, `subscription-service/migrations/0002_skin_library.sql`, `src/main/subscription-runtime.js`, `src/main/skin-publisher.js`, `src/renderer/skin-selector.js`, `tests/skin-publisher.test.mjs`, and recent `npm test` / `npm run verify` results.

The public Worker, D1, and R2 bucket are deployed at `https://licensemonitor.b100.top`. The client presents a copyable Afdian order binding code, retrieves the public online skin catalog, and installs entitlement-protected `.skinpack` downloads only after package and per-file SHA-256 verification. The service exposes public catalog and preview endpoints while requiring a device proof carrying `skins` or `creator` entitlement for package download.

The developer skin publisher validates a source directory, writes a built-in skin into `assets/skins`, or prepares a gzip-compressed `.skinpack` containing its manifest and PNG frames for online release. The remaining publication gap is an operator command that uploads the prepared package/preview to R2 and inserts or updates the `skin_releases` D1 record. A non-creator buyer end-to-end order refresh also remains unverified.
