---
title: Compliance
description: Scope discipline, database-enforced controls, generated evidence
---

## Deliberately in the lighter tier

dmops-core displays EDC-derived metrics for oversight, tracks
project-management metadata, and links to regulated records held in validated
systems. It holds no clinical data, no documents, and no signatures. The
`deliverable` table is structurally incapable of being an approval record:
no signature columns exist anywhere in the schema, and an automated check
keeps it that way (ADR-0006). This is what keeps the validation burden
proportionate.

## Controls below the application

The audit trail is written by database triggers on every domain table,
hash-chained, and verifiable end to end. The API connects as a DML-only role
that cannot create tables, cannot truncate, cannot write audit events
directly, and cannot update or delete the append-only warehouse. These
controls hold for every write path, including ad-hoc psql (ADR-0003, adopted
from ctms-core).

## Evidence is generated, never written

- `pnpm validation:iq` checks a live environment against the installed
  controls: migrations, triggers, role privileges, chain verification, and
  dictionary checksums.
- `pnpm validation:artifacts` runs the test suite and generates the OQ report
  and the requirement traceability matrix. The join key is the requirement
  token (`DM-P1`…`DM-P6` design principles, `DM-Q*` metric qualification
  cases) appearing verbatim in test names, so the matrix cannot silently
  drift from the suite.

Hand-editing `docs/validation/` is against the rules of the repository.

## Honest gaps

No formal validation program has been performed; the generated artifacts are
raw material for one. Dev auth mode is not an access-control posture. Sponsor
field-level filtering is currently a serialization rule, not configurable
ACL. The full list, kept current, is in `docs/03-compliance.md`.
