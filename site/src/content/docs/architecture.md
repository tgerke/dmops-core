---
title: Architecture and principles
description: The DM PMO layer beside the EDC, and the six principles behind it
---

DM teams carry a large, largely invisible operational load: database build,
edit-check specification and UAT, external data reconciliation, report and
dataset programming, coding, query management, lock readiness. That work is
tracked today in a diffuse mix of spreadsheets, email threads, EDC screens,
and tribal memory. The consequences are predictable: ClinOps, Biostats, and
sponsors cannot self-serve "where is the database build?", status is
re-assembled by hand for every governance meeting, and quality metrics are
recomputed inconsistently and argued about definitionally.

dmops-core's job is to make DM's work legible to every other domain without
adding a second data-entry burden to DM. It sits beside the EDC, never
inside it
([ADR-0001](/dmops-core/reference/decisions/0001-pmo-beside-the-edc/)): if a
fact lives in the EDC, an adapter reads it; if it lives nowhere else, this
system owns it, audits it, and shows one version of it to every audience.

## Design principles

These are the system's requirement tokens (`DM-P1`…`DM-P6`); tests cite them
by id, and the generated traceability matrix joins on them (see
[Compliance](/dmops-core/compliance/)).

- **DM-P1: Every field is auto-derived or authoritative, never both.** If a
  data point lives in the EDC, CTMS, safety DB, or LMS, this system reads it
  through an adapter. If it exists nowhere else, this system owns it
  outright. Dual entry is the failure mode that kills these portals.
- **DM-P2: Metrics are code, not dashboard configuration.** One versioned
  definition per KPI, consumed by every view
  ([ADR-0004](/dmops-core/reference/decisions/0004-metrics-are-versioned-code/)).
- **DM-P3: Snapshots are immutable and dated.** Metric history is
  append-only and reproduces the number as reported then
  ([ADR-0007](/dmops-core/reference/decisions/0007-append-only-snapshot-warehouse/)).
- **DM-P4: The portal displays regulated records; it does not hold them.**
  Status plus a link; signatures stay in the QMS/eTMF
  ([ADR-0006](/dmops-core/reference/decisions/0006-display-only-regulated-records/)).
- **DM-P5: Role-scoped views over one set of facts.** One truth, sliced per
  audience; never a "sponsor version" of a number.
- **DM-P6: Read-heavy, write-light.** Optimize for the daily 30-second
  glance; keep data entry minimal and where the work already happens.

## Scope

In scope: study registry, DM milestone tracking, deliverable status with
eTMF links, quality metrics from source adapters, UAT cycle and defect
tracking, an opt-in statistical programming module with study-scoped
milestones, delivery status, and programming-work metrics read from the
team's own repositories
([ADR-0011](/dmops-core/reference/decisions/0011-stat-programming-as-an-opt-in-module/),
[ADR-0012](/dmops-core/reference/decisions/0012-programming-work-frames-and-github-adapter/)),
training and access status mirrored from the LMS and the source system's
user administration
([ADR-0013](/dmops-core/reference/decisions/0013-training-and-access-mirrors/)),
lock-readiness scoring derived from the taxonomy's dependency graph
([ADR-0014](/dmops-core/reference/decisions/0014-lock-readiness-derived-from-the-taxonomy/)),
and, in a later phase, portfolio roll-up. The
DM-only deployment is the default and complete on its own; a study that
never enables the stat module sees none of it.

Out of scope, permanently: clinical data capture (the EDC), query issuance
and resolution (the EDC), document authoring or e-signature (QMS/eTMF), site
payments and monitoring (CTMS), and performing or storing statistical
analysis. Methods, outputs, and analysis datasets live in the biostat
environment; the stat module tracks the status of that work, never its
content. Out of scope for now: programming work not tied to a study, such
as R packages and internal tools. Scope discipline is what keeps the GxP
footprint small.

## Conventions that show up everywhere

Status roll-ups are database views, not stored columns; endings are dated
facts; corrections are new rows. The audit trail is written by the database,
not the application
([ADR-0003](/dmops-core/reference/decisions/0003-db-enforced-audit/)), and
the API runs as a DML-only role that cannot fabricate or edit audit events.

## The ecosystem

dmops-core is the third sibling of
[edc-core](https://github.com/tgerke/edc-core) and
[ctms-core](https://github.com/tgerke/ctms-core), sharing their
architecture: compliance below the app layer, derived-over-stored status,
generated validation evidence, and integration over plain OpenAPI
([ADR-0002](/dmops-core/reference/decisions/0002-sibling-stack-and-agpl/)).
edc-core is the reference EDC adapter; ctms-core is the reference eTMF for
deliverable evidence links. The siblings share patterns, never code:
integration is plain HTTP against documented APIs.
