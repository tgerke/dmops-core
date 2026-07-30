# ADR-0010: UAT is tracked as cycles and defects; the executed test evidence stays in the validated system

**Status**: accepted · 2026-07-30

## Decision

UAT is two tables. A `uat_cycle` is a bounded round of testing on a study
(initial build, post-amendment regression), numbered serially, carrying
status, started/completed dates, mirrored script counts
(`scripts_planned`, `scripts_executed`), and an `evidence_uri` pointing at
the executed package in the eTMF. A `uat_defect` belongs to a cycle,
numbered serially, with severity (`critical | major | minor`), a generic
lifecycle (`open | resolved | closed | withdrawn`; resolved means fix
applied and awaiting retest), a required `raised_date`, and dated endings:
`resolved_date` for resolution, a substantive `resolution_note` for closure
or withdrawal. There are no per-script execution rows and never will be:
script execution happens in the validated system and its record lives in
the eTMF; dmops-core stores counts plus a pointer (the ADR-0006 stance).

Both tables are mutable audited rows, like `deliverable`, not append-only
like `milestone_rebaseline`. A cycle cannot be marked `complete` while any
of its defects are `open` or `resolved` — the taxonomy label
"UAT complete, defects resolved" is enforced, not aspirational. The
milestone itself is never auto-written: `v_uat_cycle` derives the defect
counts, and the owner asserts `UAT.COMPLETE` with an evidence link
(derived-over-stored; the view informs, the person commits).

Writes require `dm_lead`, `dm_manager`, or `admin` — or an `analyst`
assignment on the study, the first predicate wider than
`canWriteMilestones`. The taxonomy's default owner for the UAT milestones
is `analyst`, and DM-P6 keeps data entry where the work happens. The
sponsor serialization omits `resolution_note` (DM-P5), the same curated
view as blocker notes and re-baseline reasons.

## Rationale

A defect status change is workflow state, not a correction to a governed
commitment, so the rebaseline pattern would be the wrong tool: the full
transition history is already reconstructible from `audit_event`
before/after images (ADR-0003), and append-only transition rows would
duplicate the audit trail row for row. Per-script rows would make
dmops-core the test record and pull the validation weight of the executed
package into a system designed to stay out of that scope (ADR-0001,
ADR-0006). The defect log itself is different: it is operational DM work
that exists nowhere else in the sibling stack, so this system owns it
outright (DM-P1).

## Consequences

- Reopening a completed cycle is an ordinary audited status change — loud
  in the trail, cheap in the schema.
- A sponsor sees cycles, counts, severities, and dates; the working notes
  stay internal.
- A defect-closure metric (self-sourced like `milestone_slip`, with a new
  DM-Q id) is deferred, versioned work; the live `v_uat_cycle` counts cover
  the daily glance until then.
- Mirroring per-script execution status from a source system that can
  supply it would be a capability-gated adapter feature and a new ADR, not
  a schema change here.
- No new DM-P token: this slice's tests join on DM-P4 (evidence stays in
  the validated system), DM-P5 (curated sponsor view), and DM-P6 (audited
  operational writes).
