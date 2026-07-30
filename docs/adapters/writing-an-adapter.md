# Writing a source adapter

A source adapter connects dmops-core to the system where clinical-operations
data already lives — an EDC, a CTMS, a safety database, a repository host.
Adapters are read-only: they extract normalized frames; they never write to
the source (ADR-0005).

## The contract

Implement `SourceAdapter` from `@dmops/adapter-contract` (the package depends
only on zod):

```ts
import type { SourceAdapter } from "@dmops/adapter-contract";

export const myAdapter: SourceAdapter = {
  id: "my-edc",
  capabilities: () => ({ ... }),
  extract: async ({ sourceStudyKey, frames, config }) => ({ ... }),
};
```

Three obligations:

1. **Normalized frames.** `extract` returns rows conforming to the zod schemas
   in `@dmops/adapter-contract` — the EDC frames `queries`, `subjects`,
   `visits`, `pages`, and the repository-work frames `issues`,
   `pull_requests`, `reviews` (ADR-0012). Declare only the frames your source
   honestly supplies; an undeclared frame is unsupported, which is the fail-
   closed default working as intended.
   Keys are snake_case, timestamps are ISO 8601 strings, dates are ISO dates.
   Use `checksumFrames()` so your extraction checksum is comparable to every
   other adapter's, and `validateExtraction()` will be run on your output
   before anything is written.

2. **Honest capabilities.** Declare, per frame and per field, whether your data
   is `native` (the source stores exactly this), `derived` (you computed it —
   say how in `notes`), or `unsupported`. Metrics gate on these declarations:
   an unsupported required field means the metric is reported as unavailable
   with the named gap, which is the correct outcome. Never approximate a field
   silently to make a metric light up.

3. **Config, not secrets.** `extract` receives the study's `study_source.config`
   jsonb. Credentials go through environment indirection: config names an env
   var (e.g. `apiKeyEnv`), never a key. Validate your config shape with zod and
   fail with a message an operator can act on.

## Reference implementations

- `packages/adapters/src/csv/` — the fixture adapter: reads a directory of CSV
  files, declares everything native. Start by copying this one.
- `packages/adapters/src/edc-core/` — the reference EDC adapter: authenticates
  with an edc-core study-scoped API key, maps query threads to the queries
  frame (with `first_response_at` derived from message timestamps), and
  declares `visits` unsupported because edc-core does not expose visit dates
  through its API. That declaration is the capability model working as
  intended.
- `packages/adapters/src/github/` — the repository-host adapter (ADR-0012):
  reads the repositories named in `study_source.config` and emits the
  `issues`, `pull_requests`, and `reviews` frames. Its header documents the
  GitHub documentation version and date every capability claim was verified
  against — the same bar vendor EDC adapters carry — including the derived
  three-valued PR state (GitHub's own state is only open/closed) and the
  exclusion of pending reviews.

## Where adapters live

An adapter can be contributed in-tree (a new directory under
`packages/adapters/src/`, registered in `registry.ts`) or shipped as an
external npm package that implements the contract; `study_source.adapter`
names it either way.

## Vendor adapter roadmap

The contract was designed so commercial EDC adapters can be added without
touching the engine. Known targets, unimplemented:

- **Medrio** — API capabilities to be confirmed against current Medrio vendor
  documentation before any mapping is written.
- **Medidata Rave** — likely via Rave Web Services / ODM export; capabilities,
  query lifecycle timestamp granularity, and rate limits to be confirmed
  against current Medidata documentation before any mapping is written.

A vendor adapter PR must cite the vendor documentation it was written against
(version and date). Capability claims about a vendor API that cannot be traced
to its documentation will not be merged — see CLAUDE.md.
