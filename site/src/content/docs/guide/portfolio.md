---
title: The portfolio
description: Every module's metrics rolled up across studies — pooled only where the math is exact
---

"How is the portfolio doing?" is the other governance question, and the
usual answer is a dashboard that averages whatever numbers it can reach.
dmops-core rolls up instead from what the warehouse already holds: every
number on the portfolio page is an exact aggregate of stored study-grain
snapshots
([ADR-0015](/dmops-core/reference/decisions/0015-portfolio-rollup-derived-from-study-snapshots/)).
There is no portfolio table, no portfolio compute, and no write path — the
same derived-only posture as [lock readiness](/dmops-core/guide/lock-readiness/),
one level up.

![The portfolio page as QA: the lock-readiness header with 0% across 2 studies and the readiness burn-up sparkline, a per-study table with next gates and lock dates, and metric cards grouped into Data management and Statistical programming — pooled values on the ratio and count cards, per-study spreads on the median cards](../../../assets/screenshots/portfolio.png)

## Pooling is exact or it does not happen

Snapshots store their numerator and denominator
([ADR-0007](/dmops-core/reference/decisions/0007-append-only-snapshot-warehouse/))
precisely so this page can exist. Ratio and count metrics pool as
`sum(numerator) / sum(denominator)` over each study's latest snapshot:
"0 of 16 gates satisfied" is the true portfolio fact, not an average of
percentages.

Median metrics never pool. A median of medians is not a median, and no
footnote fixes that, so the card serves the per-study spread instead — which
studies sit where, each value computed from facts — with the pooled cell
empty and labeled why. Studies reporting different versions of a metric
don't pool either: a value computed under two definitions is two numbers
wearing one label. This is the
[adapter capability model's](/dmops-core/guide/adapters/) skip-never-approximate
rule ([ADR-0005](/dmops-core/reference/decisions/0005-adapter-capability-contract/)),
applied to aggregation.

Every card carries its scope honestly. A metric no source feeds shows
"1 of 2 studies reporting" and pools over the reporting study only; stat
metrics scope to the studies that enabled the module
([ADR-0011](/dmops-core/reference/decisions/0011-stat-programming-as-an-opt-in-module/)),
and a deployment that never enabled it sees no stat section at all. The
as-of range rides beside every pooled value, because a snapshot is not
"now" and two studies' latest snapshots need not share a period.

## The readiness burn-up

The lock-readiness header pools the live gate counts across every study,
and the burn-up beside it is drawn from the monthly `lock_readiness_pct`
snapshots — the trend
[ADR-0014](/dmops-core/reference/decisions/0014-lock-readiness-derived-from-the-taxonomy/)
wrote them for. One point per reporting period, gate counts summed across
the studies that reported it. Because snapshots are immutable and dated
(DM-P3), each point reproduces what was true that month, not what the
boards say now.

## One number, one audience rule

`GET /portfolio` requires portfolio read — a `qa` or `admin` assignment.
The portfolio number is one fact at portfolio grain; a version pooled over
whichever studies the caller happens to hold would be a different portfolio
number per audience, which is exactly the "sponsor version of a number"
DM-P5 exists to prevent. The nav link shows for everyone; a study-scoped
seat that follows it gets an explanation and a pointer back to its own
studies, not a smaller portfolio.

Whether a metric pools, and how, is a closed enumeration in code beside the
compute registry: a new metric doesn't register until it declares its
portfolio behavior, and a coverage test fails if the dictionary and the
declarations ever disagree (DM-P2).
