# ADR-0004: Every metric is one versioned YAML definition plus one tested compute function

**Status**: accepted · 2026-07-30

## Decision

The governed metric dictionary lives in `metrics/*.yaml` at the repo root. Each
file carries an id, a version, and the full written definition (clock start and
stop, calendar, inclusions, exclusions, required source fields, target).
`@dmops/metrics` validates every file against a zod schema and binds each
`(id, version)` to exactly one pure compute function; a YAML file without a
registered function of the same version — or vice versa — fails at startup.
Registration copies the YAML verbatim into `metric_definition` with a checksum;
changing a file without bumping its version is a hard error. No metric may be
defined inside a BI tool.

## Rationale

Ambiguous metric definitions are the root cause of essentially every
cross-functional metrics dispute: issue-to-close vs issue-to-first-response,
business vs calendar days, auto-queries in or out. Making the definition a
reviewed, versioned file — and the calculation a pure function tested against
hand-computed fixtures — turns "what does this number mean" into a link, and
turns qualification evidence and the CI suite into the same artifact.

## Consequences

- Compute functions take normalized frames in and return snapshot rows out;
  they are testable without a database or a source system.
- v1.0 definitions use calendar days; business-day calendars with per-country
  holidays arrive as a versioned change (v1.1), exercising the version story.
- Published snapshots reference `(metric_id, metric_version)` and are never
  recomputed under a changed definition (ADR-0007).
