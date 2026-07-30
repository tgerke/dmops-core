# ADR-0008: Milestone codes are stable governed identifiers; studies may mark N/A but not invent codes

**Status**: accepted · 2026-07-30

## Decision

The DM milestone taxonomy lives in `taxonomy/milestone_definitions.yaml`:
stable dotted codes (`SPEC.DMP.APPROVED`, `CLOSE.LOCK`), phase groups,
sequence, dependencies, and repeating flags. The sync loader upserts and never
deletes; retiring a code sets `active = false`. Studies instantiate milestones
from the taxonomy and may mark any of them `na`, but cannot create codes
outside it. Every study milestone carries the planned / forecast / actual date
triple plus a separate baseline date; these are never collapsed. The API
refuses to write `baseline_date` and `planned_date` — re-baselining is a
governance action, not an edit.

## Rationale

Cross-study roll-up is only meaningful when every study speaks the same
milestone language; ad-hoc milestones are how spreadsheets diverge. Labels can
be re-worded, but codes are identifiers — reports, dependencies, and history
hang off them. The planned/forecast/actual triple is what makes slip analysis
possible at all, and the preserved baseline is what makes re-baselining honest.

## Consequences

- Repeating milestones (`COND.AMEND`, `COND.INTERIM`) store the bare code with
  an `occurrence` counter, not suffixed codes.
- Taxonomy changes are PRs against one YAML file, reviewed like code.
- A re-baselining workflow (who approves, baseline history) is deliberately
  deferred; until it exists, baselines are set at instantiation and immutable
  through the API.
