# ADR-0016: Exports re-serve stored facts with their provenance; the holiday calendar is a governed file

**Status**: accepted · 2026-07-31

## Decision

The export surface is the warehouse re-served, never a parallel computation.
Three additions, no new tables, no write path, no stored artifacts:

- **CSV exports** on the read surfaces that already exist: a study's full
  snapshot history (`GET /studies/:id/snapshots.csv`) and the portfolio
  roll-up (`GET /portfolio.csv`). Each CSV is produced by flattening the same
  rows the JSON route serves, behind the same authorization predicate. There
  is no separate export query and no separate curation path: a field a role
  cannot see in JSON does not exist for that role in CSV, structurally rather
  than by parallel bookkeeping. The snapshot CSV carries its provenance as
  columns — metric version, `computed_at`, the source extract's adapter and
  checksum — because a file that leaves the system must answer for itself.

- **The KPI pack**: `GET /studies/:id/kpi-pack?period=YYYY-MM`, one JSON
  document assembled entirely from stored facts. Per metric in the study's
  enabled modules: the registered definition (the verbatim
  `metric_definition` copy, ADR-0004), version, target, and that period's
  snapshot at study grain with site rows where they exist. Around them: the
  study header, the reporting period, `generated_at`, the requesting actor,
  and the provenance block — every `source_extract` the period's snapshots
  cite, with adapter, extraction time, and checksum. A metric with no
  snapshot for the period appears with a named absence, not a zero and not
  silence (ADR-0005). Packs are not stored: the snapshots are immutable
  (ADR-0007), so regenerating a pack for a past period reproduces it; a
  stored copy would be a second warehouse that could drift from the first.

- Reads stay unaudited. The pack does not add an audit posture that no other
  read has; its accountability story is in-band provenance, which travels
  with the artifact after it leaves the system — where an `audit_event` row
  cannot follow it anyway.

Roster mirrors stay out of exports and packs. The mirrors are display-only
copies of another system's records (ADR-0013); exporting them would
manufacture a portable file that reads as authoritative training or access
evidence, which is the same misrepresentation ADR-0006 exists to prevent.
The source system exports its own records.

**Holiday calendars** are the second half of the slice, and they are the
versioned change ADR-0004 promised: `calendars/*.yaml` at the repo root,
governed like the milestone taxonomy — dated entries, changes are PRs, the
file is read at compute time as input, not synced into a table. A study opts
in through a nullable `calendar` column (migration 0009); null means the
weekday-only counting the v1.1 definitions shipped with. The pipeline
resolves the study's calendar and passes the holiday dates into the compute
context; the compute functions stay pure. A calendar id the files do not
contain fails the refresh — a misconfigured study must not silently compute
weekday-only numbers under a definition that claims holiday awareness
(ADR-0005's fail-closed rule).

The four business-day metrics bump: `query_tat_median` and `entry_lag` to
v1.2, `pr_review_tat_median` and `pr_cycle_time_median` to v1.1. Their
definitions now read "excluding dates in the study's assigned holiday
calendar; a study with no calendar counts weekdays only." The superseded
versions stay in code, deregistered but pinned by their qualification
fixtures, exactly as v1.0 was when v1.1 landed.

The shipped calendar is fictional. Its dates belong to the fixture world's
PMO, not to any real jurisdiction — a real deployment writes
its own file from its own holiday schedule. Shipping a "US federal" calendar
from memory would put unverified real-world dates inside qualification
evidence; a fictional calendar makes the example obviously an example.

## Rationale

The temptation with exports is a second implementation: a reporting query
tuned for the file format, a pack generator with its own idea of the latest
value, a per-audience column list maintained by hand. Every one of those is
a place where the exported number can disagree with the number on screen,
and a KPI pack whose figure differs from the board it summarizes is worse
than no pack. Deriving the CSV from the same rows and the same serializers
makes disagreement unrepresentable rather than merely tested against.

Provenance rides in the artifact because the artifact outlives the session
that produced it. A pack lands in a sponsor meeting or an eTMF folder weeks
later; "which definition version, computed from which extraction, when" has
to be answerable from the file alone. The warehouse was built to make those
citations possible — snapshots carry `(metric_id, metric_version)` and a
`source_extract_id` (ADR-0007) — so the pack spends what those columns
banked, the same way the portfolio roll-up did (ADR-0015).

The calendar follows the taxonomy's governance rather than the metric
dictionary's because it is data about the deployment, not a definition of
meaning. `milestone_definitions.yaml` set the precedent: a governed input
file, PR-reviewed, consumed at compute time, pinned by the qualification
fixtures that read it verbatim — and no per-snapshot checksum of it, because
the file's history is the git history. What the version machinery does need
to know is that the counting rule changed, and it does: the bump to v1.2 is
the second real exercise of ADR-0004's version story, on the same metrics
that exercised it first.

## Consequences

- Migration 0009 is one nullable column on `study`. No grants change, no
  append-only posture is touched, no `iq.ts` exemption is added.
- Four YAML bumps, four registry entries, and holiday cases in the DM-Q5,
  DM-Q6, DS-Q1, and DS-Q2 qualification fixtures. The fixture calendar puts
  a two-day break on 2026-06-15/16, chosen so the seeded study-grain query
  TAT visibly moves (4.0 → 3.0 business days) — a version bump you can see.
- A calendar bump rolls through studies as each one refreshes. Until every
  study has recomputed, the portfolio shows "metric versions differ across
  studies" for the bumped metrics and declines to pool — ADR-0015's honest
  display, doing exactly what it was written to do.
- `packages/core` gains the export and pack assembly (`exports.ts`); the API
  gains two CSV routes and the pack route; the web app gains a printable
  pack view. Printing to PDF is the browser's job, not a server dependency.
- No new metric, no new DM-Q token for the exports themselves (the ADR-0010
  precedent): export tests join DM-P2, DM-P3, and DM-P5, since an export is
  those requirements re-served in a different content type.
- The pack's `period` parameter selects a reporting period, defaulting to
  the latest one with snapshots. Aligning studies to a common reporting
  calendar — deferred by ADR-0015 to this slice — is answered by the pack
  being explicitly period-scoped: the artifact names its period instead of
  pretending "latest" means "now".
