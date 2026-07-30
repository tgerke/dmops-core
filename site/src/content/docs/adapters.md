---
title: Adapters
description: Capability-declaring connectors to the systems where data lives
---

## The contract

A source adapter extracts normalized frames — `queries`, `subjects`,
`visits`, `pages` — from the system where clinical-operations data already
lives. The contract (`@dmops/adapter-contract`) depends only on zod: frame
schemas, a capability model, and a checksum helper so every adapter's
extraction provenance is comparable.

Adapters are read-only. They never write to the source.

## Capabilities, not optimism

Each adapter declares, per frame and per field, whether its data is `native`
(the source stores exactly this), `derived` (computed, with a note saying
how), or `unsupported`. Metrics gate on these declarations: a metric whose
required field is unsupported is skipped and reported as unavailable with the
named gap (ADR-0005).

This is visible in the demo. edc-core does not expose visit dates through its
API, so its adapter declares `visits` unsupported and the entry-lag metric
reports "unavailable: source 'edc-core' missing visits.visit_date" for
edc-core-sourced studies. That is the correct outcome. A portal that
approximates around source gaps publishes numbers nobody can defend.

## Shipped adapters

- **csv** — reads a directory of CSV fixtures, declares everything native.
  The standalone-demo path and the template to copy.
- **edc-core** — the reference EDC adapter. Authenticates with an edc-core
  study-scoped API key (env indirection, never a key in the database), maps
  query threads to the queries frame, and derives `first_response_at` from
  the first thread message not authored by the query opener.

## Writing your own

See `docs/adapters/writing-an-adapter.md` in the repository. Medrio and
Medidata Rave are named roadmap targets; a vendor adapter PR must cite the
vendor documentation it was written against, and capability claims that
cannot be traced to documentation are not merged.
