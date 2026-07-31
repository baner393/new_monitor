# ADR-0002: Use renderer-preserving soft refresh

Status: Accepted

Date: 2026-07-31

## Context

Reloading the transparent full-screen renderer could leave mouse interception stuck, making the pet and desktop appear frozen after one or more refreshes.

## Decision

Refresh in place through a single-flight request/ack protocol. Keep a navigation-generation input guard and fail open to mouse passthrough when renderer readiness or refresh acknowledgment times out.

## Consequences

Refresh work must reset renderer-owned data/UI state without ordinary navigation. Recovery may recreate the window only after the soft refresh path fails. Input-handshake tests are mandatory after lifecycle changes.

Evidence: `src/main/window-lifecycle.js`, `src/renderer/main.js`, `tests/window-lifecycle.test.mjs`.
