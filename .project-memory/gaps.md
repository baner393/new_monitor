# Reconstruction gaps

## Current integration gap

Status: Inferred on 2026-08-05. Evidence: `evidence/verification.md` and the current sandboxed build attempt.

- The Claude compatibility/control work is test-verified, but this environment did not complete either edition source build because esbuild needs a parent-directory read outside the sandbox. Re-run `npm run build:free` and `npm run build:sponsor` in a normal local shell before assigning a release-ready build result.

| Item | Status | Impact | Needed evidence |
|---|---|---|---|
| Codex App Server protocol compatibility across future Codex releases | Inferred from current official protocol and local CLI handshake | A future method or event shape may require adapter updates | Re-run real initialize, `thread/list`, `thread/read`, connect/reply, and approval smoke tests after a Codex upgrade |
| Desktop-compatible UI Automation across future Codex releases and diverse Windows machines | Confirmed on the current Windows/Codex client in compact and full-size layouts; portability rules are covered by source tests | A future client may rename its process or replace ProseMirror/InvokePattern, and endpoint policy may restrict UIA | Real E2E matrix on Windows 10/11, common DPI levels, laptops/desktops, multiple monitors, slow cold starts, and each supported Codex client update |
| Hardware coverage on diverse vendors and firmware | Unknown beyond tested machines and fixtures | Some temperatures, fans, voltage, or power fields may remain unavailable with a specific device | Ordinary/admin snapshots from AMD, Intel, NVIDIA, laptops, desktops, and multi-GPU/multi-disk systems |
| Administrator sensor-host startup on slow/security-restricted PCs | Inferred from timeout and named-pipe tests | Elevation may be delayed or blocked by endpoint security | Real-machine UAC smoke test plus captured startup diagnostics |
| Renderer bundle size warning | Confirmed by last source builds | Startup/memory optimization opportunity; not a current build failure | Profile cold startup and split only if user experience is preserved |
| Runtime-resolved font warnings from Vite | Confirmed by last source builds | Non-failing; packaged/source visual smoke test remains important | Verify both fonts in source and artifact QA after build-pipeline changes |
| Installer state after `f464545` | Unknown by design | No claim is made about installer artifacts for this revision | Run packaging only when explicitly requested, then `npm run verify:artifacts` and dual-edition smoke tests |
| Automated deterministic visual screenshots | Unknown/incomplete | Pixel/UI regressions still need source-mode visual QA | Add stable screenshot harness and golden tolerances without relying on machine-specific paths |
