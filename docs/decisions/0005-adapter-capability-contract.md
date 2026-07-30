# ADR-0005: Source adapters declare capabilities and metrics gate on them; skip, never silently approximate

**Status**: accepted · 2026-07-30

## Decision

Every source system is reached through a `SourceAdapter` that returns
normalized frames (`queries`, `subjects`, `visits`, `pages`) validated by zod
schemas in `@dmops/adapter-contract`. An adapter declares, per frame and per
field, whether its data is `native`, `derived`, or `unsupported`. A metric runs
only when every field it requires is native or derived; otherwise the engine
records a skip and the API reports the metric as unavailable with the named
gap. Extractions are checksummed and recorded in `source_extract` before any
snapshot is computed.

## Rationale

EDC APIs differ in what they expose — some cannot produce query lifecycle
timestamps at the granularity a TAT metric needs, and edc-core today does not
surface visit dates. A portal that silently approximates around such gaps
publishes numbers nobody can defend in an inspection. Declaring the gap and
skipping the metric is honest, visible, and creates the right pressure on the
source system. The adapter interface (not a hardcoded EDC) is what keeps this
project from being single-site software: edc-core is the reference adapter and
a CSV adapter makes the repo runnable standalone; Medrio, Rave, and other
vendor adapters implement the same contract.

## Consequences

- `@dmops/adapter-contract` depends only on zod, so third-party adapter authors
  take one small dependency.
- `derived` fields are permitted but annotated in provenance; `unsupported`
  fields gate metrics off.
- Every published number traces to a `source_extract` row with a checksum and
  timestamp — what you show an auditor.
- Vendor API specifics in adapter docs must be verified against vendor
  documentation, never written from memory (see CLAUDE.md).
