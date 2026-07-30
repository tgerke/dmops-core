# ADR-0007: Metric snapshots are immutable Postgres rows traceable to checksummed extracts

**Status**: accepted · 2026-07-30

## Decision

`metric_snapshot`, `source_extract`, and `metric_definition` are append-only
Postgres tables guarded by the same forbid-mutation triggers as the audit
trail. A snapshot records value, numerator, denominator, record count, grain,
period, the metric version that computed it, and the extract it came from.
"What did query TAT look like at the September interim lock" reproduces the
number as reported then; nothing recalculates history. Current state is a
derived view (`v_metric_latest`), not an updated row.

## Rationale

Append-only metric history is design principle P3 and the difference between a
dashboard and a system of record. Plain Postgres is deliberately chosen over a
DuckDB/Parquet lake (edc-core's answer for row-level clinical data): at target
scale — 200 studies × 24 months × a dozen metrics, some at site grain — this
is low millions of skinny rows, comfortably inside Postgres, and keeping them
there means the audit, immutability, IQ, and backup machinery cover the
warehouse with zero extra moving parts.

## Consequences

- Revisit threshold: if snapshot volume approaches ~100M rows or analytical
  queries need columnar scans, split the warehouse out (a future ADR).
- A bad published number is corrected by publishing a corrected snapshot at a
  later `computed_at`, never by editing — the correction is itself history.
- `metric_definition` has no `effective_to`; the current version is derived
  (`v_metric_definition_current`), matching derived-over-stored.
