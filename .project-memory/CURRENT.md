# Current architecture

Status: Confirmed at `f464545`. Evidence: `manifest.json`, files linked below.

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

Status: Confirmed. Evidence: Git commit `f464545`, `tests/codex-integration.test.mjs`.

The current head rebuilds Codex task synchronization, persistent task-detail interaction, connection ownership, incremental log reads, long-lived App Server use, fixed pixel status layers, and grip-joint-based running/blocked pet motion. The pushed branch and remote are synchronized.

## Uncommitted working-tree slice

Status: Confirmed. Evidence: `contracts/codex-state-machine.yaml`, `evidence/verification.md`, `src/main/codex-desktop-bridge.js`, and the matching tests.

The working tree repairs complete Codex message rendering and client-compatible replies. Technical tool traffic is collapsed by default; desktop-compatible mode keeps the task list visible, avoids a second App Server, navigates to the client-owned task, submits through a foreground- and composer-verified Windows UI Automation bridge, preserves Unicode text, and waits for the local session log before reporting success.
