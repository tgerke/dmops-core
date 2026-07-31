# ADR-0015: The portfolio roll-up is derived from study snapshots, pooled only where the math is exact

**Status**: accepted · 2026-07-31

## Decision

The portfolio is views over the study-grain snapshots the warehouse already
holds, not a new grain computed into it. Migration 0008 ships four views and
nothing else: no table, no write path, no new metric, no configuration.

- `v_portfolio_metric_rollup` — one row per metric over each study's latest
  snapshot: studies reporting, the pooled numerator and denominator where
  pooling is honest, the as-of range, and the min/max spread.
- `v_portfolio_metric_study` — the per-study latest values behind that row,
  the display served when pooling is not honest.
- `v_portfolio_lock_readiness` — the live gate counts of ADR-0014's
  `v_study_lock_readiness`, summed across studies.
- `v_portfolio_lock_trend` — one point per reporting period from the monthly
  `lock_readiness_pct` snapshots: the burn-up ADR-0014 wrote them for.

Pooling is exact or it does not happen (ADR-0005's fail-closed rule, applied
to aggregation instead of adapters):

- Ratio and count metrics pool as `sum(numerator) / sum(denominator)` over
  each study's latest snapshot. Snapshots store both parts (ADR-0007)
  precisely so this arithmetic is exact later.
- Median metrics never pool. A median of medians is not a median, so the
  portfolio serves a named absence and the per-study spread instead of a
  number that looks like one.
- Studies reporting different versions of a metric do not pool. A value
  computed under two definitions is two numbers wearing one label; the
  roll-up says so rather than averaging across a version bump.

Whether a metric pools, and how, is a closed enumeration in code
(`@dmops/metrics`), coverage-tested against the dictionary: a new metric
does not register until it declares its portfolio behavior (DM-P2).

The roll-up is module-aware (ADR-0011). Stat metrics report their scope as
the stat-enabled studies only, `studies_reporting` sits beside
`studies_in_scope` on every card, and a deployment that never enabled the
module sees no stat section at all. Every pooled value carries its as-of
range, because a snapshot is not "now" and two studies' latest snapshots
need not share a period.

`GET /portfolio` requires portfolio read — a `qa` or `admin` assignment.
The portfolio number is one fact at portfolio grain; a version pooled over
whichever studies the caller happens to hold would be a different portfolio
number per audience, which is the "sponsor version of a number" DM-P5
exists to prevent. Study-scoped seats keep `/studies` and get 403 here, not
a smaller portfolio.

## Rationale

ADR-0012 promised that "portfolio grain arrives with the roll-up slice for
every metric at once." Deriving from stored snapshots is how every metric
arrives at once. The alternative — adding `portfolio` to each definition's
`grain:` list — would bump eleven YAML versions, add eleven compute-registry
entries, and mint eleven qualification tokens, all to restate arithmetic the
warehouse already banked: ADR-0007 made snapshots carry `numerator`,
`denominator`, and `n_records` so that history could be reaggregated without
recomputation. This slice is that decision paying out. The `portfolio`
member of `metric_grain` stays reserved for a metric whose portfolio number
is not derivable from study parts; none exists today.

Deriving also keeps the trend honest. `lock_readiness_pct` snapshots are
immutable and dated (DM-P3), so the burn-up reproduces each month's pooled
gate count as it was reported then — a portfolio-grain recompute would
happily rewrite history every time it ran.

The refusal to pool medians is the load-bearing choice. The temptation on
every portfolio dashboard is one number per KPI, and for
`query_tat_median` that number would be wrong in a way no footnote fixes.
The honest display is the spread: which studies sit where, computed from
facts, with the pooled cell empty and labeled why. This is the same posture
as ADR-0005's skip-never-approximate, one layer up.

## Consequences

- Migration 0008 adds the four views. A derived-only slice, again: no
  grants to revoke, no audit posture to decide, no `iq.ts` exemptions.
- No new metric and no new DM-Q token (the ADR-0010 precedent). The slice's
  tests join on DM-P2, DM-P3, and DM-P5; the qualification enumeration in
  `tools/validation-artifacts.ts` is untouched.
- `packages/metrics` gains the pooling enumeration; `packages/core` gains
  `portfolioRollup`; the web app gains `/portfolio`, the first page scoped
  to a role rather than a study. The nav link shows for everyone — hiding
  it would require the web layer to know roles, which it never has — and a
  study-scoped seat that follows it gets an explanation, not an error dump.
- A metric no source feeds still appears, reporting fewer studies than its
  scope. Absence stays named (ADR-0005): a portfolio card that silently
  pooled two of three studies would read as the whole portfolio.
- The roll-up reads `v_metric_latest`, which serves the latest compute per
  study regardless of period. The as-of range on each card is the honest
  label for that; aligning studies to a common reporting calendar is the
  exports-and-calendars slice's problem, not this one's.
