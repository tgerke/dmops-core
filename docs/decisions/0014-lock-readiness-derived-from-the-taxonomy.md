# ADR-0014: Lock-readiness is derived from the taxonomy's dependency graph, never entered

**Status**: accepted · 2026-07-31

## Decision

Lock-readiness is a checklist the system computes, not a status anyone types.
The gate set for database lock is the transitive `depends_on` closure of
`CLOSE.LOCK` in the governed milestone taxonomy (ADR-0008), filtered per
study by enabled modules exactly as the board is. Today that closure is
eight closeout milestones — LPO through soft lock; if the checklist is ever
wrong, the fix is a taxonomy PR, reviewed like code, and every study's
readiness recomputes. There is no lock-readiness table, no configuration,
and no write path: the slice ships as two views and one metric.

- `v_study_lock_gate` — one row per study × gate: the definition joined to
  the study's milestone facts, with `satisfied` (status is `complete`) and
  `applicable` (status is not `na`) derived per row.
- `v_study_lock_readiness` — one row per study: applicable/satisfied/blocked
  counts, `readiness_pct`, the next unmet gate in sequence order, and the
  planned/forecast/actual dates of `CLOSE.LOCK` itself.

The score is the unweighted percent of applicable gates satisfied. Weights
were considered and rejected: a weighting scheme is dashboard configuration
wearing a lab coat, and DM-P2 exists to keep that out of the product. The
number is deliberately blunt; the per-gate checklist beside it is the real
surface.

The summary view also carries **signals** — live evidence the system already
holds that bears on lock: open queries as of the latest `query_open_aging`
snapshot (with its period-end date, since a snapshot is not "now"), UAT
cycles still open and defects not yet closed, and training gaps from the
access roster (ADR-0013). Signals never move the score. The score rolls up
DM leadership's milestone assertions; the signals are the system's own
evidence displayed beside them — the same posture as the training mirrors
next to `REL.TRAIN`. One contradiction is called out by name: `CLOSE.QUERY`
asserted complete while the latest snapshot still shows open queries. The
API returns it as an `evidence_conflicts` entry rather than silently
lowering a number.

One new metric, `lock_readiness_pct` v1.0 (DM-Q9, `module: dm`,
`grain: [study]`), snapshots the answer monthly so the
portfolio roll-up (the next slice) gets a readiness trend, not just today's
value. It is dmops-native like `milestone_slip`: no source frames, computed
from milestone facts plus the definition graph, with "satisfied as of
period end" meaning an actual completion date on or before period end. To
keep the compute a pure function (ADR-0004), `ComputeContext` gains the
milestone definitions alongside the milestone facts.

## Rationale

"How close is this study to lock?" is the governance question DM answers by
hand today — a slide assembled from the EDC, the defect log, and memory,
re-argued every meeting. Every fact it needs is already in this system:
milestone statuses, UAT state, query snapshots, the training roster. Deriving
the answer is DM-P1 applied to a roll-up: a readiness score that can be
hand-set is a second copy of the milestone board that will drift from it,
and a score that can be typed the week before an inspection is worse than no
score.

Deriving the gate set from `depends_on` rather than a hardcoded list means
the checklist has exactly one definition. The taxonomy already encodes what
soft lock requires — queries resolved, SAE reconciliation, coding, external
data, SDV — because ADR-0008 put the dependency graph under governance. A
separate lock-readiness configuration would be a second place that knowledge
lives, and the two would disagree within a quarter.

The SQL closure (recursive CTE) and the TypeScript closure (in the metric
compute) are two implementations of one derivation. That duplication is
accepted and fenced: both are tested against the same expected gate list for
the shipped taxonomy, so a taxonomy change that moves one without the other
fails the suite.

Interim locks are deferred, not forgotten. `COND.INTERIM` is repeating, and
readiness for a data cut is scoped to a visit window this system cannot see
(the EDC knows which pages are in the cut; we do not, DM-P1). The final-lock
checklist is the version that is honest with the data we hold.

## Consequences

- Migration 0007 adds the two views. Nothing new is written, so there are no
  grants to revoke, no audit posture to decide, and no `iq.ts` exemptions —
  the pleasant consequence of a derived-only slice.
- `metrics/lock_readiness_pct.yaml` (DM-Q9) joins the dictionary; the
  qualification-token list in `tools/validation-artifacts.ts` gains DM-Q9
  with hand-computed expectations in the DM-Q4 style (constructed facts, not
  fixture CSVs — the source is our own tables).
- `refreshStudyMetrics` fetches `milestone_definition` alongside
  `study_milestone` for native metrics; `ComputeContext.definitions` is
  optional and absent for adapter-fed metrics.
- `GET /studies/{studyId}/lock-readiness` returns the summary, the gate
  list, the signals, and any evidence conflicts. Sponsor serialization omits
  gate blocker notes, the board's rule (DM-P5); everything else is dates and
  statuses, which is what a sponsor auditing lock progress is owed.
- A study that has never instantiated a gate milestone still shows the gate,
  unsatisfied — the checklist comes from the definition graph, so absence of
  a row reads as "not done," never "not asked."
- The signal columns surface named absence, not fake zeros: no
  `query_open_aging` snapshot means null with no as-of date, ADR-0005's
  fail-closed rule applied to display.
