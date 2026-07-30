---
title: Writing a metric
description: One YAML definition, one compute function, one qualification test
---

Adding a KPI to dmops-core means writing three things: a versioned YAML
definition anyone can read, a pure compute function, and a qualification
test against hand-computed expected values. The three are bound together by
`(id, version)`, and the system refuses to start if any leg is missing
([ADR-0004](/dmops-core/reference/decisions/0004-metrics-are-versioned-code/)).

## The definition file

Every metric lives in `metrics/<id>.yaml`. This is the shipped
`query_tat_median` definition, verbatim:

```yaml
# Governed metric definition (ADR-0004). Changing anything here requires a
# version bump; registration rejects a changed file with an unchanged version.
id: query_tat_median
label: Query turnaround time (median)
owner: DM Operations
version: "1.1"
grain: [study, site]
definition: >
  Median elapsed business days from query issuance to query closure, across
  queries closed within the reporting period. Issue-to-close, not
  issue-to-first-response. Business days are Monday through Friday by UTC
  date: the count of weekday dates strictly after the issuance date, up to
  and including the closure date. No holiday calendar in v1.1; per-country
  holidays are a future versioned change. v1.0 measured calendar days.
clock_start: queries.opened_at
clock_stop: queries.closed_at
calendar: business_days
include:
  - manual queries
  - system-generated queries requiring site response
exclude:
  - cancelled queries
source_frames: [queries]
required_fields:
  queries: [opened_at, closed_at, status]
refresh: daily
target: "<= 5 business days"
```

The `definition` block is the written definition a data manager would defend
in a governance meeting: clock start and stop, calendar, inclusions,
exclusions. `required_fields` is what the capability gate checks against the
study's adapter: if the source cannot supply a field, the metric is skipped
and reported as unavailable, never approximated
([ADR-0005](/dmops-core/reference/decisions/0005-adapter-capability-contract/)).
`grain` names the levels the metric computes at: `study`, `site`, `country`,
or `portfolio`.

A definition may also carry `module` (`dm` or `stat`, defaulting to `dm`
when omitted, as every shipped metric does today). A metric tagged for a
module a study has not enabled is filtered out of that study's strip and
compute runs entirely, rather than sitting permanently unavailable
([ADR-0011](/dmops-core/reference/decisions/0011-stat-programming-as-an-opt-in-module/)).
The first `stat` metrics arrive with the repository frames
([ADR-0012](/dmops-core/reference/decisions/0012-programming-work-frames-and-github-adapter/)).

## The version rule

Registration copies each YAML file into the database verbatim with a
checksum. A changed file with an unchanged version is a hard startup error.
There is no "small edit" path: a changed definition is a new version, with
its own compute function, and the old version's function stays in the
codebase so historical snapshots remain reproducible under the definition
that computed them.

## The compute function and its test

Each `(id, version)` binds to exactly one pure function in
`packages/metrics`, registered in the compute registry. The function
receives extracted frames and a reporting period and returns value,
numerator, denominator, and record count per grain.

Qualification is a test, not a ceremony: each metric version is verified
against expected values on the fixture study
(`fixtures/study-DMOPS-001`), where the expected numbers were computed from
the CSVs by hand. The test names carry `DM-Q*` tokens, which join them into
the generated traceability matrix. Renaming a test away from its token
silently drops it from the matrix, so don't.

## Checklist

1. Write `metrics/<id>.yaml` with `version: "1.0"`.
2. Implement the compute function in `packages/metrics` and add the
   `(id, version)` registry entry.
3. Hand-compute expected values on the fixture study and add the `DM-Q*`
   qualification test.
4. Run `pnpm test`, then `pnpm metrics:refresh` against the seeded demo to
   see the card appear on the board.
