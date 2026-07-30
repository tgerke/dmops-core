---
title: Milestones
description: The governed taxonomy and the board
---

## One taxonomy, every study

The DM milestone taxonomy lives in `taxonomy/milestone_definitions.yaml`:
stable dotted codes (`SPEC.DMP.APPROVED`, `CLOSE.LOCK`) grouped into five
phases — specification, build, validation and release, conduct, closeout.
Studies instantiate milestones from the taxonomy and may mark any of them
N/A, but cannot invent codes outside it (ADR-0008). Cross-study roll-up only
works when every study speaks the same milestone language.

Taxonomy changes are pull requests against one YAML file, reviewed like code.
The sync loader validates the dependency graph and upserts; retiring a code
sets `active: false`, never deletes.

## Planned, forecast, actual — never collapsed

Every study milestone carries four dates. `baseline_date` is the original
commitment and survives re-baselining. `planned_date` is the current plan.
`forecast_date` is what the team currently expects. `actual_date` is what
happened. Slip is computed, not entered: forecast versus planned while in
flight, actual versus baseline once complete.

The API deliberately refuses to write `baseline_date` and `planned_date`.
Re-baselining is a governance action with an approval trail, not an edit; that
workflow is future work, and until it exists baselines are immutable through
the API.

## Repeating milestones

Protocol amendments and interim locks repeat. The taxonomy stores the bare
code (`COND.AMEND`, `COND.INTERIM`) with a repeating flag; each occurrence is
numbered, so `COND.INTERIM` occurrence 2 is the second data cut.

## Blockers and evidence

A blocked milestone carries a blocker note, visible to internal roles and
excluded from the sponsor serialization. An evidence link points at the
record in the eTMF; dmops-core stores status plus a URI and never the
document itself (ADR-0006).
