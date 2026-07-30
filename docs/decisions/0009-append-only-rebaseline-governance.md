# ADR-0009: Re-baselining is an append-only governed action, not an edit

**Status**: accepted · 2026-07-30

## Decision

Re-baselining a study milestone appends a `milestone_rebaseline` row —
numbered per milestone, carrying the new planned date, the previous planned
date, a required reason, and an optional reference URI (for example an eTMF
pointer to a protocol amendment) — and updates
`study_milestone.planned_date` in the same audited transaction.
`baseline_date` is never writable after instantiation, by anyone, through any
endpoint. The action requires a `dm_manager` assignment on the study or
`admin`; `dm_lead` may move forecasts but not the plan. The rebaseline table
rejects UPDATE and DELETE for every role, and its history is queryable
(`GET .../milestones/{code}/rebaselines`). The board view exposes
`rebaseline_count` and the latest rebaseline timestamp. Milestones already
`complete` or `na` cannot be re-baselined.

## Rationale

This exercises the deferral in ADR-0008: baselines are honest only if the
original commitment survives every re-plan. Derived-over-stored applies — the
record of change is the appended row; the current plan on `study_milestone`
is the projection. Keeping both slip measures meaningful is the point:
`milestone_slip` v1.0 keeps measuring actuals against the original baseline,
while forecast slip measures against the current plan, so a re-baseline
changes neither metric's definition. Requiring a reason and restricting the
action above routine edits makes the governance record worth reading.

## Consequences

- Baseline stays a one-time instantiation fact. A baseline entered wrongly at
  instantiation is corrected by migration-grade intervention, loud by design.
- Reason text is internal: the sponsor serialization omits it, the same
  curated-view stance as blocker notes (DM-P5).
- A controlled reason vocabulary, dual approval, or a batch endpoint for
  protocol amendments touching many milestones would each be new ADR-worthy
  work; slice 2 ships single-milestone, free-text-reason re-baselining.
- `milestone_slip` needs no version bump for this feature; a future
  `milestone_slip_vs_plan` metric measuring against the current plan would be
  a new metric, not a new version.
