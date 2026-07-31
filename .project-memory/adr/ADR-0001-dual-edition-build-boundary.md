# ADR-0001: Preserve a build-time dual-edition boundary

Status: Accepted

Date: 2026-07-31

## Context

The product has a free edition and a sponsor edition. The sponsor edition includes the custom/developer entry; the free edition must not expose it. Monitoring and Codex integration must behave identically.

## Decision

Select the edition with `VITE_EDITION=free|sponsor`, compile the boundary into the app, give packages distinct application IDs/product/executable names, and verify artifacts rather than relying on hidden menu elements.

## Consequences

Every source-build or packaging change must verify both editions. Shared fixes belong in common code. Installer generation remains an explicit operation because it is slow and has historically lost resources.

Evidence: `electron-builder.config.js`, `scripts/build.mjs`, `scripts/verify-artifacts.mjs`, `AGENTS.md`.
