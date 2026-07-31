# System specification

## Goal

Status: Confirmed. Evidence: `README.md`, `package.json`, `src/renderer/main.js`.

Turtle Monitor is a transparent Windows Electron desktop pet rendered with PixiJS. It combines pet physics and skins, a hardware dashboard, and an optional local Codex task companion.

## Actors and boundaries

- User: interacts with the pet, settings, monitor manager/details, and Codex bubbles.
- Electron main process: owns windows, IPC, persistence, system sampling, sensor-host lifecycle, elevation, and Codex App Server/log synchronization.
- Preload: exposes the narrow renderer API documented in `contracts/renderer-api.md`.
- Renderer: owns Pixi animation, transparent-window hit testing, dashboard UI, Codex UI, and view drafts.
- Native sensor host: a bundled x64 .NET Framework 4.7.2 process backed by LibreHardwareMonitor 0.9.6.
- External tools: Windows CIM/performance sources, vendor GPU tools, and the local Codex CLI/App Server.

## Invariants

Status: Confirmed. Evidence: `AGENTS.md`, `src/main/window-lifecycle.js`, `scripts/verify-project.mjs`, `src/shared/*.js`.

- The full-screen transparent window must fail open to mouse passthrough after renderer/navigation failure.
- User refresh uses the soft refresh coordinator; repeated requests are single-flight and do not navigate the current page during normal recovery.
- Hardware absence, permission limits, query failures, first-sample states, and unavailable firmware/driver fields remain distinguishable.
- Monitor config preserves desired visibility independently of current hardware availability.
- Codex task detail opened by the user persists across status snapshots; new alerts queue instead of replacing it.
- App Server requests are acted on only with known request identities and supported request types.
- Runtime paths do not embed developer-specific drive letters or usernames.
- Edition differences are build-time controlled and verified, not merely hidden with UI CSS.

## Persistence ownership

Status: Confirmed. Evidence: `src/main/index.js`, `src/shared/monitor-panel-config.js`, `src/shared/codex-integration.js`.

Electron `userData` owns app settings, selected skin, monitor configuration, Codex integration configuration, and imported user skins. Repository and packaged assets are read-only. Runtime-learned speed baselines are not persisted.

## Startup and shutdown

Status: Confirmed. Evidence: `src/main/index.js`, `src/renderer/main.js`.

Electron creates the transparent pet window, installs the preload bridge, starts monitoring services, and initializes renderer-owned interaction. Shutdown commits normal UI drafts, stops watchers/readers, and disposes window/input guards.

## Non-goals

Status: Confirmed. Evidence: `DEPLOY-SECURITY.md`, `AGENTS.md`.

- Ordinary source verification does not generate installers.
- Free edition does not expose sponsor-only custom/developer entry points.
- The app does not install a new kernel driver as part of current monitoring behavior.
