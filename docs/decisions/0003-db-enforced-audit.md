# ADR-0003: The audit trail is written and guarded by the database, adopted from ctms-core

**Status**: accepted · 2026-07-30

## Decision

`audit_event` rows are produced by AFTER-triggers on every domain table, with
the acting person supplied via `set_config('dmops.actor_id', …)` per
transaction. Events are hash-chained in-DB (pgcrypto, advisory-lock
serialized). UPDATE/DELETE on `audit_event` and on the append-only warehouse
tables raise an exception for all roles. The API connects as a DML-only
`dmops_app` role that cannot insert audit events directly. This is ctms-core's
ADR-0003 machinery, ported with `dmops_` naming.

## Rationale

Milestone dates and deliverable status are inspection-facing operational
records: "when did the forecast slip, who moved it, and why" must be answerable
without reconstruction. An application-layer audit writer is one forgotten code
path away from a gap; triggers make every write path — API, seed scripts,
ad-hoc psql — leave the same trail. The pattern is already proven in ctms-core;
diverging would mean two audit dialects in one ecosystem.

## Consequences

- Writes go through `withActor` in `@dmops/core`; writes without it are still
  audited, attributed to `system`.
- The audit chain serializes writes via an advisory lock, so the test suite
  runs with `fileParallelism: false`.
- Migrations that must rewrite history need explicit, documented trigger
  disablement — loud by design.
