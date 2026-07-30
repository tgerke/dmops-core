---
title: Glossary
description: The terms of art, each linked to the page that treats it fully
---

**Baseline date**: a milestone's original committed date. It has no write
path and survives every re-plan, which is what keeps slip analysis honest.
See [Milestones](/dmops-core/guide/milestones/).

**Planned date**: the current plan for a milestone. Moves only through the
governed re-baseline action, never through an ordinary edit.

**Forecast date**: what the team currently expects. Freely editable by DM
leadership while the milestone is in flight.

**Actual date**: what happened, entered when the milestone completes.

**Slip**: computed, never entered: forecast versus planned while in
flight, actual versus baseline once complete. Shown as the `+Nd` / `-Nd`
badges on the board.

**Re-baseline**: the governance action that moves a planned date: an
append-only record of the old and new dates with a required reason,
performed by a DM manager or admin. The board shows a `⟲N` counter. See
[Milestones](/dmops-core/guide/milestones/) and
[ADR-0009](/dmops-core/reference/decisions/0009-append-only-rebaseline-governance/).

**Phase group**: one of the five sections of the board: Startup —
Specification, Startup — Build, Startup — Validation & Release, Conduct,
Closeout. See the
[milestone taxonomy](/dmops-core/reference/milestone-taxonomy/).

**Occurrence**: the instance number of a repeating milestone: protocol
amendments and interim locks can happen more than once per study.

**Blocker note**: the internal narrative on a blocked milestone. Visible
to internal roles, excluded from the sponsor serialization. See
[Personas and access](/dmops-core/personas-and-access/).

**Deliverable**: a controlled document's status row: type, version, owner,
status chip, approved date, and an eTMF link. Never the document itself.
See [Deliverables](/dmops-core/guide/deliverables/).

**eTMF URI / evidence link**: the pointer from a status row to the
regulated record in the system that owns it
([ADR-0006](/dmops-core/reference/decisions/0006-display-only-regulated-records/)).

**UAT cycle**: a bounded round of user acceptance testing on a study
build, with status, dates, mirrored script counts, and an evidence link.
See [UAT](/dmops-core/guide/uat/).

**Defect**: a finding inside a UAT cycle: severity (`critical`, `major`,
`minor`) and a lifecycle of `open`, `resolved` (awaiting retest), `closed`
(verified), or `withdrawn`.

**Completion gate**: the rule that a UAT cycle cannot be marked complete
while any defect is open or awaiting retest
([ADR-0010](/dmops-core/reference/decisions/0010-uat-cycles-and-defects-not-test-evidence/)).

**Adapter**: a read-only connector that extracts normalized frames from a
source system. See [Adapters](/dmops-core/guide/adapters/).

**Frame**: a normalized extraction table defined by the adapter contract:
the EDC frames `queries`, `subjects`, `visits`, `pages`, the
programming-work frames `issues`, `pull_requests`, `reviews`
([ADR-0012](/dmops-core/reference/decisions/0012-programming-work-frames-and-github-adapter/)),
and the roster frames `training_records`, `access_grants`
([ADR-0013](/dmops-core/reference/decisions/0013-training-and-access-mirrors/)).

**Pull request**: a repository host's unit of proposed change and review.
In the stat module it is source data, read through the `pull_requests` and
`reviews` frames; the code and the review record stay in the repository,
which dmops-core links to and never holds.

**Capability**: an adapter's per-field honesty declaration: `native`,
`derived` (with a note saying how), or `unsupported`. Metrics gate on
capabilities and report unavailable rather than approximating
([ADR-0005](/dmops-core/reference/decisions/0005-adapter-capability-contract/)).

**Grain**: the level a metric computes at: `study`, `site`, `country`, or
`portfolio`. See [Metrics](/dmops-core/guide/metrics/).

**Reporting period**: the dated window a snapshot covers; the board's
trend view is one point per period.

**Snapshot**: one immutable computed metric value: value, numerator,
denominator, record count, grain, period, metric version, and the extract
checksum it came from
([ADR-0007](/dmops-core/reference/decisions/0007-append-only-snapshot-warehouse/)).

**Extract**: one checksummed adapter extraction run, the provenance record
snapshots point back to.

**Metric version**: the `(id, version)` pair binding a YAML definition to
its compute function. A changed definition is a new version. See
[Writing a metric](/dmops-core/guide/writing-a-metric/).

**Taxonomy**: the governed list of 38 milestone codes every study draws
from ([ADR-0008](/dmops-core/reference/decisions/0008-governed-milestone-taxonomy/)).

**Module**: the discipline a taxonomy code or metric belongs to. `dm` is
the default and covers everything shipped today; `stat` covers statistical
programming and arrives as an opt-in. A study that never enables a module
sees none of it
([ADR-0011](/dmops-core/reference/decisions/0011-stat-programming-as-an-opt-in-module/)).

**SAP**: the Statistical Analysis Plan, the biostat-owned document that
defines a study's planned analyses. In the stat module it appears as a
deliverable status row and the `STAT.SAP.APPROVED` milestone; the document
itself stays in the eTMF.

**SDTM**: the standardized tabulation format study data is mapped into
after collection. The stat module tracks SDTM production and QC as
`STAT.SDTM.*` milestones; the datasets stay in the biostat environment.

**ADaM**: the analysis-ready dataset format derived from SDTM, the input
to tables and figures. Tracked as the `STAT.ADAM.*` milestones and the
`adam_spec` deliverable type.

**TLF**: tables, listings, and figures, the output package of an analysis.
Shell approval, production, and QC are the `STAT.TLF.*` milestones.

**Double programming**: independent re-programming of a dataset or output
by a second programmer, compared against the first. The QC convention
behind the `STAT.*.QC` milestones; the comparison evidence lives in the
repository, linked, never stored here.

**Assignment**: a person's role on a specific study, the unit all
authorization derives from. See
[Personas and access](/dmops-core/personas-and-access/).

**Audit chain**: the hash-chained `audit_event` table written by database
triggers on every domain table; `/health` verifies it end to end
([ADR-0003](/dmops-core/reference/decisions/0003-db-enforced-audit/)).

**Requirement token**: the `DM-P1`…`DM-P6` and `DM-Q*` ids that appear
verbatim in test names and join the suite into the generated traceability
matrix. See [Compliance](/dmops-core/compliance/).
