# Turtle Monitor project memory

Status: Confirmed at Git revision `f464545`. Evidence: `manifest.json` and Git history.

The repository also has a confirmed uncommitted Codex companion repair; its authoritative behavior and validation are in `contracts/codex-state-machine.yaml` and `evidence/verification.md`.

This package is the compact handoff entry for the Windows Electron desktop-pet project.

## Reading order

1. Read [../HANDOFF.md](../HANDOFF.md) for the human handoff and current working rules.
2. Read [REBUILD.md](REBUILD.md) for exact setup, run, test, and source-build commands.
3. Read [SPEC.md](SPEC.md), then [CURRENT.md](CURRENT.md), for system boundaries and the architecture map.
4. Open only the relevant contract:
   - [contracts/editions.json](contracts/editions.json)
   - [contracts/monitor-panel-config.schema.json](contracts/monitor-panel-config.schema.json)
   - [contracts/codex-integration-config.schema.json](contracts/codex-integration-config.schema.json)
   - [contracts/codex-state-machine.yaml](contracts/codex-state-machine.yaml)
   - [contracts/renderer-api.md](contracts/renderer-api.md)
5. Read [gaps.md](gaps.md) before changing hardware elevation, Codex App Server compatibility, or packaging.

## Hard invariants

- Preserve both editions and their feature boundary; the authoritative matrix is `contracts/editions.json`.
- Do not create installers unless the user explicitly requests packaging in the current turn.
- Keep the authenticated remote URL and baseline branch recorded in `evidence/repository.json`.
- Keep paths portable: repository-relative, module-relative, `app.getAppPath()`, `process.resourcesPath`, or Electron `userData` only.
- Refresh must remain renderer-preserving and fail open for transparent-window mouse passthrough.
- Free and sponsor editions share monitoring and Codex integration behavior.

One-command acceptance: `npm test && npm run verify && npm run build:free && npm run build:sponsor` (PowerShell: run the four commands sequentially).

Known limits: [gaps.md](gaps.md).
