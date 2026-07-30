# Compliance posture

dmops-core is deliberately scoped to the lighter validation tier: it displays
EDC-derived metrics for oversight, tracks project-management metadata
(milestones, deliverable status), and links to regulated records held in
validated systems. It holds no clinical data, no documents, and no signatures
(ADR-0006). The applicable posture is qualified calculations, pipeline
integrity, and a trustworthy audit trail on operational writes — not full
21 CFR Part 11 electronic-signature scope.

The requirement ids below (`DM-P1`…`DM-P6`, from docs/01-vision.md) are the
join key for generated validation evidence: they appear verbatim in test
names, and `pnpm validation:artifacts` builds the traceability matrix from a
live test run. `DM-Q*` ids are per-metric qualification cases: each metric's
compute function is verified against hand-computed expected values on a fixture
study.

## Requirement → mechanism

| Requirement | Mechanism | Where |
| --- | --- | --- |
| DM-P1 — every field auto-derived or authoritative, never both | Source adapters with per-field capability declarations; metrics skip rather than approximate when a source cannot supply a field; milestone/deliverable facts owned here and nowhere else | packages/adapter-contract, packages/metrics/src/engine.ts |
| DM-P2 — metrics are code, not dashboard configuration | One YAML definition + one tested compute function per metric version; registration copies the YAML verbatim with a checksum; changing a file without a version bump is a hard error | metrics/, packages/metrics |
| DM-P3 — snapshots are immutable and dated | Forbid-mutation triggers on metric_snapshot, source_extract, metric_definition, milestone_rebaseline; DML-only app role additionally lacks UPDATE/DELETE on them; every snapshot references its extract checksum | packages/db/migrations/0001_audit_and_views.sql, 0002_app_role.sql, 0003_milestone_rebaseline.sql |
| DM-P4 — displays regulated records, does not hold them | deliverable table stores status + eTMF URI only; no signature columns, no file storage anywhere in the schema | packages/db/src/schema.ts |
| DM-P5 — role-scoped views over one set of facts | role × study assignment scoping on every read; sponsor serialization excludes internal fields (blocker notes, re-baseline reasons); one underlying view per fact | apps/api/src/app.ts, packages/db/migrations/0001 (v_ views) |
| DM-P6 — read-heavy, write-light | Board and summary reads are single-view queries; the operational writes are the milestone and deliverable-status PATCHes plus the governed re-baseline action, all audited via withActor | apps/api, packages/core/src/milestones.ts, packages/core/src/deliverables.ts |

Supporting mechanisms, adopted from ctms-core (ADR-0003): hash-chained
`audit_event` written by AFTER-triggers on every domain table, actor identity
per transaction, `dmops_verify_audit_chain()` for tamper detection, and a
DML-only `dmops_app` runtime role that cannot fabricate audit events.

## Honest gaps (current phase)

1. **No formal validation program has been performed.** The IQ script, OQ
   report, and traceability matrix are generated raw material for one; the CSV
   program is organizational work this repo cannot do for you.
2. **Dev auth mode exists.** `DMOPS_AUTH_MODE=dev` maps static tokens to
   seeded people and is not an access-control posture; production requires
   `oidc` against a real IdP.
3. **Milestone facts are manually entered in slice 1.** Several milestones
   (e.g. `COND.FPI`, first data entered) are EDC-derivable and should
   eventually auto-complete from adapter data; until then they are owned
   manual facts per DM-P1, not mirrors.
4. **Sponsor field-level filtering is a serialization rule, not yet a
   configurable ACL.** The sponsor role is row-scoped and blocker notes are
   excluded; per-sponsor curated view configuration is future work.
5. **Business-day calendars are weekday-only.** The elapsed-time metrics
   (query_tat_median, entry_lag) moved to a Monday–Friday clock as v1.1,
   the versioned-change path ADR-0004 prescribes. Per-country holiday
   calendars remain future versioned work, not silently approximated.
6. **eTMF links are URIs, not verified references.** If the eTMF is not
   addressable by stable URI, links rot; surfacing link health is future work.
