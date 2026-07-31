# ADR-0018: Visit dates come from a per-study CRF mapping, and a capability posture may depend on config

**Status**: accepted · 2026-07-31

## Decision

Neither commercial EDC adapter can read a visit date from a fixed API field,
because in both systems the visit date is a study-specific CRF item, not a
platform fact (ADR-0017 headers, both marked "named deferral"). This slice
resolves that deferral differently for each vendor, on the evidence:

1. **Rave: shipped as config.** The Rave adapter gains an optional
   `visitDateItem` config entry — `{ formOid, itemOid, dateFormat }` — naming
   the CRF item that carries the visit date in that study's build. The
   adapter reads the item's entered value off the ClinicalAuditRecords tape
   it already replays: rwslib's audit parser reads a `Value` attribute on
   `ItemData` (extras/audit_event/parser.py, consulted 2026-07-31) [V-OSS],
   so no second extraction subsystem is needed and Clinical Views stay
   unused. Replay semantics: the chronologically last observed value per
   (subject, event instance) wins, regardless of audit subcategory — so
   corrections land without claiming any subcategory vocabulary beyond what
   ADR-0017 already cites. An empty `Value` clears the date; a non-empty
   value that does not parse under the declared format fails the extraction
   with the observed value in the message (ADR-0017).

2. **`dateFormat` is a closed, operator-declared set.** Rave's date
   rendering is study-configured and not publicly enumerated [NC], so the
   adapter never sniffs formats. The operator declares one of
   `yyyy-MM-dd` or `dd MMM yyyy` (English three-letter months — part of the
   declared format's definition, not a vendor claim), and anything that
   fails to parse under it is a loud error, not a guess.

3. **The capability contract learns about config.**
   `SourceAdapter.capabilities()` becomes `capabilities(config?)`: with a
   valid config carrying `visitDateItem`, the Rave posture reports
   `visits.visit_date` as `derived`; without one it stays `unsupported`.
   Callers that hold a study's `study_source.config` pass it; adapters that
   don't need it ignore the argument. `capabilities` must never throw —
   absent or invalid config yields the conservative posture.

4. **Medrio: investigated and not publicly implementable.** The public
   OpenAPI document (`Medrio OpenApi v.42.14.0.201`, re-fetched 2026-07-31)
   exposes entered data only through write endpoints —
   `POST /api/study/{studyId}/dataentry` and
   `POST .../visit/{visitId}/form/{formId}/dataentry` — and no endpoint
   returns entered values [P]. A CRF mapping cannot be honest without a read
   surface, so Medrio's `visit_date` stays `unsupported` and the deferral is
   closed as a documented dead end, to be reopened only if Medrio publishes
   a data-read API.

## Rationale

entry_lag was gated off for every vendor-sourced study by exactly one
missing field. The field exists in these systems — as a CRF item whose
identity only the study team knows — so the honest way to light the metric
is the pattern ADR-0017 already set with `statusMap`: study-configured
vocabulary crosses the contract through explicit per-study config, never
through adapter guesses. Extending that pattern from field *values* to field
*support* is the smallest contract change that keeps the capability
declarations truthful: a Rave study without a mapping genuinely cannot
supply visit dates, and its posture must say so.

## Consequences

- `capabilities()` call sites (the snapshot pipeline, the API's metrics
  endpoint) now pass the study's source config; a call site without config
  gets the conservative posture, which fails closed (DM-P1).
- A mapped Rave study computes entry_lag as derived; an unmapped one keeps
  the named gap. Both postures are pinned in the engine tests against the
  real adapter.
- A study whose date rendering is outside the closed format set cannot be
  mapped yet; extending the set is a code change with tests, not a config
  free-for-all. A mis-declared format surfaces as a failed extraction with
  the observed value in hand — operator-actionable, by design.
- The visit-date map rides the audit tape, so a date entered under an event
  instance the adapter never saw "Entered" data for is dropped rather than
  invented; scheduled-but-unvisited instances remain unobservable
  (ADR-0017).
- No schema migration, no new metric, no metric version bumps: entry_lag's
  definition is unchanged — a new source can now satisfy its required
  fields.
