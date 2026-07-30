# dmops-core — working rules

## Constraints that will bite you

1. **The API refuses to boot without `DMOPS_AUTH_MODE`.** Set `dev` or `oidc`
   explicitly (`cp .env.example .env` handles dev).
2. **The seed is destructive and regenerates every UUID.** `pnpm db:seed`
   truncates everything, including the audit trail. Never point it at a real
   deployment; anything caching a study or person id goes stale on re-seed.
3. **Append-only tables cannot be cleaned up by tests.** `audit_event`,
   `metric_snapshot`, `source_extract`, and `metric_definition` reject UPDATE
   and DELETE for every role. Tests use rollback transactions or tolerate
   accumulation; re-seed to reset.
4. **The API runs as the DML-only `dmops_app` role.** No DDL, no TRUNCATE, no
   direct `audit_event` writes, no UPDATE/DELETE on the warehouse. If a new
   feature needs a privilege the role lacks, that is a design smell — see
   ADR-0003 before reaching for the owning role.
5. **Audit-chain appends are serialized by an advisory lock.** The test suite
   runs with `fileParallelism: false`; do not "fix" slow tests by re-enabling
   parallelism.
6. **Never change a `metrics/*.yaml` without bumping `version:`.**
   Registration hard-errors on a changed file with an unchanged version, and
   the compute registry must gain a matching `(id, version)` entry (ADR-0004).
7. **Never hand-edit `docs/validation/`.** Those files are generated from live
   runs (`pnpm validation:artifacts`, `pnpm validation:iq`). Hand-written
   validation evidence is worse than none.
8. **Requirement tokens are load-bearing.** `DM-P1`…`DM-P6` and `DM-Q*` in
   test names are the traceability join key; renaming a test away from its
   token silently drops it from the matrix.

## Regulatory and vendor claims

Never write regulatory specifics (21 CFR Part 11, ICH E6, GAMP) or vendor API
capabilities (Medrio, Medidata Rave, or any EDC) from model memory. Verify
against authoritative source text or vendor documentation and cite what was
consulted. A plausible-sounding wrong compliance claim in a
compliance-positioned product is an audit finding; a wrong vendor-API claim
ships a broken adapter. Capability declarations in adapters must be honest:
`derived` with a note, or `unsupported` — never `native` by optimism
(ADR-0005).

## Conventions

- Sibling repos (edc-core, ctms-core) are prior art; port patterns, never
  share code. Integration is plain HTTP against documented APIs.
- ADR numbers are the cross-reference key: cite them in migration headers,
  test describe blocks, and non-obvious code.
- Derived-over-stored: status roll-ups are views (`v_*`), endings are dated
  facts, corrections are new rows.
- Milestone writes go through `withActor`; a write path that skips it gets
  attributed to `system`, which is a bug in everything except migrations,
  sync, and seed.
