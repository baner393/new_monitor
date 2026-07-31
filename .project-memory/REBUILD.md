# Rebuild and verification

Status: Confirmed. Evidence: `package.json`, `package-lock.json`, `AGENTS.md`, `scripts/verify-project.mjs`.

## Phase 1 — Checkout and dependencies

Inputs: Node.js 22+, npm, Windows 10/11 x64, Git, `package-lock.json`.

```powershell
git clone https://baner393@github.com/baner393/new_monitor.git
Set-Location new_monitor
git switch stable-81e7580
npm ci
```

The normal checkout already contains the x64 .NET Framework 4.7.2 hardware-reader runtime under `resources/hardware-sensor`; ordinary development does not rebuild it.

Pass: `npm test` exits 0.

## Phase 2 — Source verification

```powershell
npm run verify
npm run build:free
npm run build:sponsor
```

Deliverables: verified resources plus successful Vite/Electron source builds for both editions. These commands do not create installers.

Pass: all three commands exit 0. Runtime-resolved font warnings and Vite's large-renderer-chunk warning are currently non-failing observations; see `gaps.md`.

## Phase 3 — Source-mode UI smoke tests

Start only one edition at a time:

```powershell
npm run start:free
npm run start:sponsor
```

Check the pet, click-through behavior, soft refresh repeatedly, monitoring cards/details, Codex task badge/detail/reply flow, and edition boundary. Close the process after each smoke test.

Pass: the checklist in `evidence/verification.md` is satisfied.

## Phase 4 — Installer packaging (explicit request only)

Read `BUILDING.md` and `contracts/editions.json` first. Then use `npm run dist` or the edition-specific dist commands and finish with `npm run verify:artifacts`.

Installer generation is intentionally outside ordinary handoff verification.
