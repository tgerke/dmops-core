# ADR-0011: Statistical programming is an opt-in module built on the existing primitives

**Status**: accepted · 2026-07-30

## Decision

dmops-core gains discipline modules. Every taxonomy code and metric
definition carries a `module` tag: `dm` is the default and covers everything
shipped through slice 3; `stat` is the first addition. A study opts into
modules (the storage mechanism, column versus table, is decided at
implementation). Milestone instantiation, the board, and the metrics strip
filter on the study's enabled modules. A deployment that never enables
`stat` sees today's product exactly: no new board section, no metrics
reporting permanently unavailable.

The stat module tracks study-scoped statistical programming and
biostatistics work with the primitives that already exist. It adds no
tables and no board surface. It adds governed taxonomy codes in a new
`analysis` phase group (label "Analysis & Reporting", rendered after
Closeout on stat-module studies), conventional deliverable types (`sap`,
`adam_spec`, `tlf_shells`, joining the seeded `sdtm_spec`), and a
phase-scoped write posture: a `programmer` or `biostat` assignment on the
study writes analysis-phase milestones and analysis deliverable types,
alongside DM leadership; DM-phase milestones remain DM-leadership-only.

Per-program and per-script tracking is ruled out permanently. The Git
repository and its CI hold the authored programs, the review record, and
the run evidence; dmops-core stores milestone status, deliverable status,
and links (the ADR-0006 stance, restated for code artifacts as ADR-0010
restated it for test scripts). Non-study programming work (R packages,
internal tools, standards repos) stays outside the study-scoped model;
bringing it in would be a new decision.

The analysis codes, all `phase_group: analysis` and `module: stat`:

| Code | Label | Seq | Default owner | depends_on |
| --- | --- | --- | --- | --- |
| `STAT.SAP.APPROVED` | Statistical Analysis Plan approved | 400 | biostat | |
| `STAT.SDTM.PROD` | SDTM production datasets complete | 410 | programmer | SPEC.SDTM |
| `STAT.SDTM.QC` | SDTM QC / double programming complete | 420 | programmer | STAT.SDTM.PROD |
| `STAT.ADAM.SPEC` | ADaM specification approved | 430 | biostat | STAT.SAP.APPROVED, SPEC.SDTM |
| `STAT.ADAM.PROD` | ADaM production datasets complete | 440 | programmer | STAT.ADAM.SPEC, STAT.SDTM.PROD |
| `STAT.ADAM.QC` | ADaM QC / double programming complete | 450 | programmer | STAT.ADAM.PROD |
| `STAT.TLF.SHELLS` | TLF shells approved | 460 | biostat | STAT.SAP.APPROVED |
| `STAT.TLF.PROD` | TLF production complete | 470 | programmer | STAT.TLF.SHELLS, STAT.ADAM.PROD |
| `STAT.TLF.QC` | TLF QC / double programming complete | 480 | programmer | STAT.TLF.PROD |
| `STAT.DRYRUN` | Analysis dry run complete | 490 | programmer | STAT.ADAM.PROD, STAT.TLF.PROD |
| `STAT.DELIVER.INTERIM` | Interim analysis delivered | 500 | biostat | COND.INTERIM |
| `STAT.DELIVER.FINAL` | Final analysis delivered | 510 | biostat | CLOSE.TRANSFER, STAT.SDTM.QC, STAT.ADAM.QC, STAT.TLF.QC |

`STAT.DELIVER.INTERIM` is repeating, with occurrences, like the
`COND.INTERIM` it depends on. `CLOSE.TRANSFER` is the handoff joint:
`STAT.DELIVER.FINAL` depending on it is what wires DM closeout and analysis
delivery together on one board. `BUILD.DATASETS` stays active in the `dm`
module; a study that enables `stat` marks it `na` in favor of
`STAT.SDTM.PROD` and `STAT.ADAM.PROD` (guidance, not automation).

## Rationale

The forces are the ones ADR-0001 named for DM, one team over. Programming
status lives in repository issues, tracker spreadsheets, and standup
memory; DM, ClinOps, and sponsors cannot self-serve "where are the ADaM
datasets?", so the answer is re-assembled by hand for every governance
meeting. The `programmer` and `biostat` roles have sat in the assignment
enum since slice 1; this decision gives them something to own. One governed
code vocabulary is what makes cross-study roll-up possible (ADR-0008), and
the phase-scoped write posture follows ADR-0010: data entry belongs to the
team doing the work (DM-P6).

The module boundary exists because the first audience keeps its product.
An organization that wants a traditional DM workbench gets one, with
nothing to configure away: no analysis section to ignore, no repository
metrics reading "unavailable" forever. Opt-in is per study rather than per
deployment because portfolios are mixed: the same organization can run
studies with in-house programming and studies where analysis belongs to a
CRO.

Retiring `BUILD.DATASETS` was considered and rejected. It is the dm
module's only analysis-dataset milestone, and a DM-only deployment still
tracks dataset programming as a startup commitment. Keeping it active and
marking it `na` on stat-module studies costs one line of guidance;
retirement would have removed a milestone from the audience this decision
promises not to disturb.

## Consequences

- Slice work, citing this ADR: the `phase_group` enum gains `analysis`
  (migration), `milestone_definition` and the metric spec gain `module`
  defaulting to `dm`, study-level module opt-in lands with its filtering in
  the board view and the metrics endpoint, the `PHASE_GROUPS` list in
  `site/scripts/sync-generated.mjs` and the board section labels in
  `apps/web` grow by one, a phase-scoped write predicate joins
  `packages/core/src/authz.ts` with tests, and the seed gains dev tokens
  for the biostat and programmer personas plus one stat-enabled study so
  both postures are demoable.
- The taxonomy YAML edit is a PR reviewed like code (ADR-0008); the table
  above is the reviewed design.
- Vision and architecture scope wording changes: performing or storing
  statistical analysis (methods, outputs, datasets) stays out permanently;
  tracking the operational status of that work comes in behind the module
  flag.
- No new DM-P token: tests for this work join on DM-P1 (owned facts),
  DM-P5 (role-scoped views), and DM-P6 (entry where the work happens).
- Repository-derived metrics for this module are a separate decision
  (ADR-0012).
