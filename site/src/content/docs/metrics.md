---
title: Metrics
description: One versioned definition, one tested function, immutable snapshots
---

## The dictionary is the product

Every metric is defined once, in a versioned YAML file under `metrics/`, with
the full written definition: clock start and stop, calendar, inclusions,
exclusions, required source fields, and target. The dashboard is a view over
the dictionary, not the other way around. No metric is defined inside a BI
tool (ADR-0004).

Each `(id, version)` binds to exactly one pure compute function in
`packages/metrics`. A YAML file without a matching function, or a function
without a file, fails at startup. Changing a file without bumping its version
is a hard registration error: a changed definition is a new version.

## Qualification is the test suite

Every compute function is verified against hand-computed expected values on a
small fixture study (`fixtures/study-DMOPS-001`). The expected values were
computed from the CSVs by hand, not by the code under test, and the tests
carry `DM-Q*` tokens that join them into the generated traceability matrix.
Qualification evidence and CI are the same artifact.

## Snapshots are history, not state

Computed values append to `metric_snapshot`, guarded by database triggers
that reject UPDATE and DELETE for every role. A snapshot records value,
numerator, denominator, record count, grain, period, the metric version that
computed it, and the checksummed extract it came from. Asking what a KPI
looked like at a past lock reproduces the number as reported then
(ADR-0007). Current state is a view over history.

## The starter dictionary

| Metric | v1.0 definition in short |
| --- | --- |
| `query_tat_median` | Median calendar days, issuance to closure, closed in period |
| `query_open_aging` | Open queries older than 30 days at period end |
| `entry_lag` | Median days from visit date to first data entry |
| `milestone_slip` | Median days, baseline to actual, completed in period |

v1.0 uses calendar days throughout. Business-day clocks with per-country
holiday calendars are a planned versioned change, which is the version story
working as intended: the old numbers stay reproducible under the old
definition.
