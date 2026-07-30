# Vision

DM teams carry a large, largely invisible operational load: database build,
edit-check specification and UAT, external data reconciliation, report and
dataset programming, coding, training and delegation, query management, lock
readiness. That work is tracked today in a diffuse mix of spreadsheets, email
threads, EDC screens, and tribal memory. The consequences are predictable:
ClinOps, Biostats, and sponsors cannot self-serve "where is the database
build?", status is re-assembled by hand for every governance meeting, quality
metrics are recomputed inconsistently and argued about definitionally, and
inspection evidence is reconstructed retrospectively.

dmops-core's job is to make DM's work legible to every other domain without
adding a second data-entry burden to DM.

Statistical programming teams carry a parallel load: SDTM and ADaM
production, QC programming, TLF delivery, analysis handoffs. That work is
tracked today in repository issues and standup memory, and it is just as
invisible to everyone else. An opt-in stat module (ADR-0011) gives it the
same treatment. The DM-only deployment stays the default and is complete on
its own; an organization that never enables the module sees a traditional
DM workbench and nothing else.

## Design principles

These are the system's requirement tokens (`DM-P1`…`DM-P6`); tests cite them
by id, and the traceability matrix in `docs/validation/` joins on them.

- **DM-P1 — Every field is auto-derived or authoritative, never both.** If a
  data point lives in the EDC, CTMS, safety DB, or LMS, this system reads it
  through an adapter. If it exists nowhere else, this system owns it outright.
  Dual entry is the failure mode that kills these portals.
- **DM-P2 — Metrics are code, not dashboard configuration.** One versioned
  definition per KPI, consumed by every view (ADR-0004).
- **DM-P3 — Snapshots are immutable and dated.** Metric history is append-only
  and reproduces the number as reported then (ADR-0007).
- **DM-P4 — The portal displays regulated records; it does not hold them.**
  Status plus a link; signatures stay in the QMS/eTMF (ADR-0006).
- **DM-P5 — Role-scoped views over one set of facts.** One truth, sliced per
  audience; never a "sponsor version" of a number.
- **DM-P6 — Read-heavy, write-light.** Optimize for the daily 30-second
  glance; keep data entry minimal and where the work already happens.

## Scope

In scope: study registry, DM milestone tracking, deliverable status with eTMF
links, quality metrics from source adapters, UAT cycle and defect tracking
(ADR-0010), an opt-in statistical programming module with study-scoped
milestones, delivery status, and programming-work metrics read from the
team's own repositories (ADR-0011, ADR-0012), and — in later phases —
training and access mirrors, lock-readiness scoring, and portfolio roll-up.

Out of scope, permanently: clinical data capture (the EDC), query issuance and
resolution (the EDC), document authoring or e-signature (QMS/eTMF), site
payments and monitoring (CTMS), and performing or storing statistical
analysis. Methods, outputs, and analysis datasets live in the biostat
environment; the stat module tracks the status of that work, never its
content. Out of scope for now: programming work not tied to a study, such as
R packages and internal tools (ADR-0011 keeps the model study-scoped). Scope
discipline is what keeps the GxP footprint small.

## The ecosystem

dmops-core is the third sibling of [edc-core](https://github.com/tgerke/edc-core)
and [ctms-core](https://github.com/tgerke/ctms-core), sharing their
architecture: compliance below the app layer, derived-over-stored status,
generated validation evidence, and integration over plain OpenAPI (ADR-0002).
edc-core is the reference EDC adapter; ctms-core is the reference eTMF for
deliverable evidence links.
