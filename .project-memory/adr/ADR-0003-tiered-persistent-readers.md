# ADR-0003: Prefer tiered sampling and persistent readers

Status: Accepted

Date: 2026-07-31

## Context

Spawning PowerShell and vendor utilities for every metric every few seconds produced unnecessary CPU and power overhead.

## Decision

Group metrics by volatility, cache static/support information, reuse long-lived Windows and hardware readers where available, query vendor fields in batches, and reduce sampling when panels are hidden or the system is idle/on battery. Pet frame rate remains unchanged.

## Consequences

Each metric needs freshness metadata and must not confuse a cached/static value with a failed live read. Performance changes must preserve UI responsiveness and animation frame rate.

Evidence: `src/main/system-monitor.js`, `src/main/hardware-sensor-monitor.js`, `src/main/gpu-monitor.js`, commit `1f48780`.
