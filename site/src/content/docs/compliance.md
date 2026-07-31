---
title: Compliance
description: Scope discipline, database-enforced controls, generated evidence
---

:::danger[What dmops-core does and does not claim]
No software product is compliant on its own; compliance is a property of a
validated deployment inside an organization's quality system. dmops-core is
deliberately scoped so the validation burden stays proportionate, ships
generated evidence as raw material for a validation program, and keeps a
public list of gaps. It does not claim a completed validation program, and
it structurally cannot hold the records that carry signature requirements.
:::

## Deliberately in the lighter tier

dmops-core displays EDC-derived metrics for oversight, tracks
project-management metadata, and links to regulated records held in validated
systems. It holds no clinical data, no documents, and no signatures. The
`deliverable` table is structurally incapable of being an approval record:
no signature columns exist anywhere in the schema, and an automated check
keeps it that way
([ADR-0006](/dmops-core/reference/decisions/0006-display-only-regulated-records/)).
The applicable posture is qualified calculations, pipeline integrity, and a
trustworthy audit trail on operational writes.

## Requirement → mechanism

The requirement ids below (`DM-P1`…`DM-P6`, defined in
[Architecture and principles](/dmops-core/architecture/)) are the join key
for generated validation evidence: they appear verbatim in test names, and
`pnpm validation:artifacts` builds the traceability matrix from a live test
run. `DM-Q*` ids are per-metric qualification cases, with `DS-Q*` as the
same mechanism for the stat-module metric dictionary
([ADR-0012](/dmops-core/reference/decisions/0012-programming-work-frames-and-github-adapter/)).

| Requirement | Mechanism |
| --- | --- |
| DM-P1: every field auto-derived or authoritative, never both | Source adapters with per-field capability declarations; metrics skip rather than approximate when a source cannot supply a field; milestone and deliverable facts owned here and nowhere else; training and access status mirrored from the LMS and source user administration with no write path in this system ([ADR-0013](/dmops-core/reference/decisions/0013-training-and-access-mirrors/)) |
| DM-P2: metrics are code, not dashboard configuration | One YAML definition plus one tested compute function per metric version; registration copies the YAML verbatim with a checksum; changing a file without a version bump is a hard error |
| DM-P3: snapshots are immutable and dated | Forbid-mutation triggers on `metric_snapshot`, `source_extract`, `metric_definition`, and `milestone_rebaseline`; the DML-only app role additionally lacks UPDATE/DELETE on them; every snapshot references its extract checksum |
| DM-P4: displays regulated records, does not hold them | `deliverable` stores status plus an eTMF URI only; `uat_cycle` mirrors script execution as counts plus an evidence URI, never the executed package; the roster mirrors hold dated status replaced each refresh with extract provenance, read-only for the API role ([ADR-0013](/dmops-core/reference/decisions/0013-training-and-access-mirrors/)); no signature columns or file storage anywhere in the schema |
| DM-P5: role-scoped views over one set of facts | Role × study assignment scoping on every read; the sponsor serialization excludes internal fields (blocker notes, re-baseline reasons, defect resolution notes); one underlying view per fact |
| DM-P6: read-heavy, write-light | Board and summary reads are single-view queries; the operational writes are milestone, deliverable-status, and UAT operations plus the governed re-baseline action, all audited via `withActor` |

Supporting mechanisms, adopted from ctms-core
([ADR-0003](/dmops-core/reference/decisions/0003-db-enforced-audit/)):
hash-chained `audit_event` written by AFTER-triggers on every domain table,
actor identity per transaction, `dmops_verify_audit_chain()` for tamper
detection, and a DML-only `dmops_app` runtime role that cannot fabricate
audit events. These controls hold for every write path, including ad-hoc
psql.

## Evidence is generated, never written

- `pnpm validation:iq` checks a live environment against the installed
  controls: migrations, triggers, role privileges, chain verification, and
  dictionary checksums.
- `pnpm validation:artifacts` runs the test suite and generates the OQ report
  and the requirement traceability matrix in `docs/validation/`. Because the
  join key is the requirement token appearing verbatim in test names, the
  matrix cannot silently drift from the suite.

Hand-editing `docs/validation/` is against the rules of the repository.
Hand-written validation evidence is worse than none.

## Honest gaps (current phase)

1. **No formal validation program has been performed.** The IQ script, OQ
   report, and traceability matrix are generated raw material for one; the
   CSV program is organizational work this repository cannot do for you.
2. **Dev auth mode exists.** `DMOPS_AUTH_MODE=dev` maps static tokens to
   seeded people and is not an access-control posture; production requires
   `oidc` against a real IdP.
3. **Milestone facts are manually entered in this phase.** Several
   milestones (e.g. `COND.FPI`, first data entered) are EDC-derivable and
   should eventually auto-complete from adapter data; until then they are
   owned manual facts per DM-P1, not mirrors.
4. **Sponsor field-level filtering is a serialization rule, not yet a
   configurable ACL.** The sponsor role is row-scoped and blocker notes are
   excluded; per-sponsor curated view configuration is future work.
5. **Holiday calendars are one-per-study, and the shipped one is
   fictional.** The business-day metrics subtract the study's governed
   calendar (`calendars/*.yaml`, ADR-0016), but a study gets exactly one
   calendar — per-country or per-site calendars for multi-region studies
   are future versioned work. The example calendar's dates are deliberately
   fictional; a deployment must author its own before the holiday-aware
   numbers mean anything.
6. **eTMF links are URIs, not verified references.** If the eTMF is not
   addressable by stable URI, links rot; surfacing link health is future
   work.
