# ADR-0012: Programming work reaches metrics through new normalized frames and a capability-declaring GitHub adapter

**Status**: accepted · 2026-07-30

## Decision

The adapter contract gains three normalized frames: `issues`,
`pull_requests`, and `reviews`. They are vocabulary owned by dmops-core,
not a mirror of any vendor payload, exactly as `queries` is not a Medrio or
Rave shape. At concept level: an issue carries a source id, repository key,
state, and opened/closed timestamps; a pull request carries a state (open,
merged, closed) with the matching timestamps; a review carries the pull
request it belongs to, a reviewer key, a state, and a submitted timestamp.
The zod schemas land with the implementation slice, strict like the
existing four.

Frames are additive. Capabilities fail closed (ADR-0005): an adapter that
does not declare a frame is `unsupported` for it, so the csv and edc-core
adapters are untouched by the addition. A GitHub adapter implements
`SourceAdapter` unchanged: per-frame and per-field capability
declarations, checksummed extractions into `source_extract`, the same
provenance chain every published number already has. Which repositories
feed a study is `study_source` configuration, defined at slice time.
`releases` and CI-run frames are named and deferred: no starter metric
needs them, and adding a frame later is cheap by construction.

The metric starter set, all `grain: [study]` and `module: stat`
(ADR-0011):

- `pr_review_tat_median`: median business days from pull request opened to
  its earliest completed review (`pull_requests`, `reviews`).
- `pr_cycle_time_median`: median business days from pull request opened to
  merged (`pull_requests`).
- `issue_closure_lag_median`: median calendar days from issue opened to
  closed (`issues`).
- `issue_open_aging`: count of open issues older than 30 days at the
  snapshot (`issues`; the `query_open_aging` pattern, including its
  deferred finer buckets).
- `release_cadence` is named and deferred until a `releases` frame exists.

Each arrives as one versioned YAML plus one qualified compute function
(ADR-0004), with qualification tests carrying a new `DS-Q1`… token series.

This decision makes no claim about what the GitHub API exposes. Every
field-level `native`, `derived`, or `unsupported` declaration waits for the
implementation slice and must cite the GitHub documentation version and
date it was written against, the same bar Medrio and Rave adapters carry
(ADR-0005, CLAUDE.md). Whether a given timestamp is native or derived is
exactly what the capability declaration answers then, not here.

## Rationale

Statistical programming teams already run their work through a repository
host, and the operational exhaust (issues opened and closed, reviews
requested and completed, branches merged) is the same kind of signal that
query and entry timestamps are for DM. Reading it through the adapter
contract keeps DM-P1 intact: the facts live in the source system,
dmops-core reads them, nobody double-enters status. Normalized frames
rather than vendor payloads keep the door open for other hosts; GitHub is
the first adapter, not a dependency, the same posture that keeps edc-core
a reference rather than a requirement.

Grain is `study` only. Site and country are EDC concepts with no meaning
for repository work, and portfolio grain arrives with the roll-up slice
for every metric at once.

The token series is `DS-Q`, not a continuation of `DM-Q`: the two metric
dictionaries stay legible in the traceability matrix, and `DM-Q` remains a
closed enumeration of the DM suite.

## Consequences

- The metric spec's `source_frames` values derive from the contract's
  frame names, so the YAML schema widens without an edit of its own.
- The qualification-token array and its doc comment in
  `tools/validation-artifacts.ts` gain the DS-Q entries at slice time;
  without that, DS-Q tests would silently drop from the matrix.
- DS metrics carry `module: stat`, so a DM-only deployment never sees them
  (ADR-0011).
- Qualification fixtures are hand-computed like `fixtures/study-DMOPS-001`,
  with a synthetic repository extract.
- A GitHub adapter PR that asserts a capability without a documentation
  citation does not merge, the same rule as vendor EDC adapters.
