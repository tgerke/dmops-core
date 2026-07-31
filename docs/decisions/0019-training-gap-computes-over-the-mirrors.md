# ADR-0019: The training-gap metric computes over the mirrors, not one source's extraction

**Status**: accepted · 2026-07-31

## Decision

`access_training_gap` becomes v2.0, and its input changes: the compute reads
the study's two mirror tables — `training_mirror` and `access_mirror` — that
the refresh pipeline already maintains (ADR-0013), instead of the frames of a
single source's extraction. The math is unchanged; what changes is where the
join lives, and therefore when the metric is available. Four parts:

1. **The dictionary learns to say it.** The metric spec schema gains an
   `input` field, `extraction | mirrors`, default `extraction`. It is a
   governed fact about the definition — the KPI pack serves it, and a reader
   of the YAML can see which of the three sourcing postures a metric holds:
   frames from one extraction (the EDC metrics), this system's own facts
   (`milestone_slip`, `lock_readiness_pct`), or the mirrors. `input: mirrors`
   is legal only for the two mirror frames; `loadSpecs` rejects anything
   else.

2. **Availability follows the mirrors' own feeding rule.** A mirror is fed
   by the first active source whose capabilities support the frame
   (ADR-0013). A mirror-fed metric is therefore gated per frame: for each
   required frame, find the source that would feed that mirror, and check
   the metric's required fields against that source's declared capabilities.
   No source supporting a frame, or the feeding source missing a required
   field, is a named gap (DM-P1) — the union across sources is what makes
   the split deployment work, and the per-frame check is what keeps it
   honest: availability is claimed only for data some source actually
   declares it can deliver.

3. **The pipeline computes after the source loop.** Once every source has
   extracted and the mirrors are replaced, the mirror-fed metrics read the
   mirror tables and compute. If a feeding source's extraction failed this
   run, the mirror keeps its previous rows for the roster (ADR-0013) but the
   metric is skipped with the failure named — a snapshot is never quietly
   computed over rows the run failed to refresh.

4. **Snapshot provenance takes the native posture.** A mirror-fed snapshot
   cites no single `source_extract` — in a split deployment two extractions
   feed it, and `metric_snapshot` cites one. This is the posture
   `milestone_slip` and `lock_readiness_pct` already hold: the snapshot's
   inputs carry their own provenance (each mirror row cites the extract that
   wrote it, and `source_extract` is append-only, so the run's extracts stay
   on record), and the CSV export and KPI pack already render the absent
   citation. v1.0 cited its one extract; v2.0 trades that single citation
   for cross-source availability, and says so here rather than pretending
   the column fits.

Alongside this, the API's metrics endpoint stops reading a single
`study_source` row and evaluates availability across all active sources,
ordered by adapter — the same deterministic rule the pipeline has applied
since ADR-0012. Extraction metrics report the first source that can feed
them, or every source's named gaps; mirror-fed metrics report the per-frame
check above.

## Rationale

ADR-0013 shipped the gap metric with an honest limitation: the pipeline
feeds each metric from a single extraction, so in a split deployment —
access grants from the EDC, training from an LMS — `access_training_gap`
reported unavailable while the roster view answered live, because only the
view joined the mirrors. That ADR named the fix: a cross-source compute over
the mirrors themselves, the `milestone_slip` pattern. This slice is that
fix, taken now because it needs no new evidence — no vendor claim, no
migration, no new table — only machinery this system already trusts: the
mirrors are replaced each refresh with validated, extract-cited rows, and
the compute is the same pure function DM-Q8 has pinned since v1.0.

Computing over the mirrors rather than re-joining in-run frames is
deliberate. The mirrors are the system's one honest record of "training and
access as this refresh saw them"; a metric that read ad-hoc frame
combinations would duplicate that join in a second place and could drift
from what the roster displays. Metric and roster now answer the same
question from the same rows — the snapshot is the roster's monthly number,
by construction.

## Consequences

- The version machinery (ADR-0004) is exercised a third time, and for the
  first time as a major bump: sourcing posture changed, math did not. One
  compute function serves both versions' DM-Q8 pins; the registry maps only
  `2.0`, and the qualification tests state that the hand-computed truth is
  identical across versions.
- In the demo (csv feeds both frames), the value, numerator, and
  denominator are unchanged; the snapshot's extract citation moves to the
  mirror rows. The seeded metric counts do not move.
- A split EDC + LMS deployment gets the snapshot trend the moment an LMS
  adapter exists. That adapter is still the deferral it was — the split
  posture is pinned in the engine tests against edc-core's real
  capabilities plus a synthetic LMS posture, which is the honest maximum
  until one ships (ADR-0005: no invented adapter, no invented claims).
- A study with no active sources skips the metric exactly as before; a
  study whose only source is an EDC reports the gap by name —
  `training_records` has no feeder — instead of a silent zero.
- `DM-Q8` keeps its token (the ADR-0016 precedent: a version bump joins the
  existing token; the matrix row is permanent).
