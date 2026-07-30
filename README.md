# dmops-core

An open-source system of record for clinical Data Management operations: how DM
work is planned, executed, evidenced, and reported. It sits beside the EDC,
never inside it. Milestone boards, deliverable status with eTMF links, and
quality metrics computed from source systems through capability-declaring
adapters, with every published number traceable to a checksummed extract.

Sibling to [edc-core](https://github.com/tgerke/edc-core) (data capture) and
[ctms-core](https://github.com/tgerke/ctms-core) (TMF/regulatory documents),
sharing their architecture: compliance enforced by the database rather than
the application, derived-over-stored status, and validation evidence generated
from live runs. edc-core is the reference EDC adapter; ctms-core is the
reference home for the regulated records this portal links to but never holds.

## Why

- DM teams track database builds, edit checks, UAT, reconciliation, and lock
  readiness in spreadsheets and email. ClinOps, Biostats, and sponsors cannot
  self-serve "where is the database build?", so DM leads spend their week
  re-assembling status by hand (ADR-0001).
- Quality metrics get recomputed inconsistently and argued about
  definitionally. Here every metric is one versioned YAML definition plus one
  tested compute function, qualified against hand-computed fixtures; no metric
  is defined in a BI tool (ADR-0004).
- Metric history is append-only. "What did query TAT look like at the
  September interim lock" reproduces the number as reported then (ADR-0007).
- Source systems differ in what their APIs expose. Adapters declare per-field
  capabilities and metrics gate on them: a number the source cannot support is
  reported unavailable with the named gap, never silently approximated
  (ADR-0005).
- Milestone dates and deliverable status are inspection-facing, so every write
  lands in a hash-chained audit trail written by database triggers; the API
  runs as a role that cannot alter it (ADR-0003).

## Layout

| Path | Contents |
| --- | --- |
| `metrics/` | The governed metric dictionary (versioned YAML) |
| `taxonomy/` | The governed DM milestone taxonomy |
| `packages/db` | Postgres schema, migrations, audit machinery, seed, IQ script |
| `packages/adapter-contract` | Frame schemas, capability model, adapter interface (zod only) |
| `packages/adapters` | CSV fixture adapter and the edc-core reference adapter |
| `packages/metrics` | YAML loader, compute functions, capability gating |
| `packages/core` | Audited domain operations and the snapshot pipeline |
| `apps/api` | Hono + zod-openapi API; spec at `/openapi.json`, reference at `/docs` |
| `apps/web` | React milestone board and metrics strip |
| `fixtures/` | Synthetic demo study with hand-computed expected values |
| `docs/` | Vision, compliance mapping, ADRs, generated validation artifacts |
| `tools/` | Metric refresh CLI, validation artifact generator |

## Quick start

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/tgerke/dmops-core)

The codespace boots Postgres, migrates, and seeds a demo portfolio. Locally:

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm dev
```

Open http://localhost:5175 and pick a persona: the DM lead can edit the
board, ClinOps reads it, the sponsor seat gets the curated view, QA sees the
whole portfolio. The seeded study DMOPS-001 is wired to a CSV fixture source,
so the metrics strip is live on first boot; DMOPS-002 has no source, which is
how you see honest "unavailable" states instead of zeros.

Useful commands: `pnpm test` (the suite doubles as qualification evidence),
`pnpm validation:iq` (checks installed controls against a live database),
`pnpm validation:artifacts` (regenerates the traceability matrix and OQ
report), `pnpm metrics:refresh` (cron-friendly snapshot computation).

## Status

A working slice 1, not a product. What exists: the study registry, the full
DM milestone taxonomy with a role-scoped board and audited writes, deliverable
status with eTMF pointers, four qualified metrics flowing through the adapter
pipeline into an immutable snapshot warehouse, and the CSV + edc-core
adapters. What does not exist yet: UAT and defect tracking, training and
access mirrors, lock-readiness scoring, portfolio roll-up views, exports and
KPI packs, re-baselining governance, business-day metric calendars, and
Medrio/Rave adapters (the contract is designed for them; see
`docs/adapters/writing-an-adapter.md`).

This is not validated software. The IQ script, OQ report, and traceability
matrix are generated raw material for a validation program; running that
program is organizational work. See `docs/03-compliance.md`, including its
honest-gaps section.

## License

AGPL-3.0, same as its siblings: anyone can run, study, and improve this, and
nobody can take it closed and sell it back to the teams it serves.
