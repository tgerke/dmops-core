# dmops-core

An open-source system of record for clinical Data Management operations: how DM
work is planned, executed, evidenced, and reported. It sits beside the EDC,
never inside it. Milestone boards, deliverable status with eTMF links, and
quality metrics computed from source systems through capability-declaring
adapters, with every published number traceable to a checksummed extract.
An opt-in module extends the same treatment to statistical programming
teams; a DM-only deployment never sees it (ADR-0011).

**Documentation: https://tgerke.github.io/dmops-core/** covers a guided
tour, role-based reading tracks, the full user guide with screenshots, and
the published design decisions.

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
- Statistical programming teams already run their work through GitHub. The
  opt-in stat module reads that exhaust (issues, pull requests, reviews)
  through the same capability-declaring adapter contract instead of asking
  anyone to re-enter status, and organizations that skip the module never
  see it (ADR-0011, ADR-0012).

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
board, the analyst logs UAT defects, ClinOps reads it, the sponsor seat gets
the curated view, QA sees the whole portfolio. The seeded study DMOPS-001 is wired to a CSV fixture source,
so the metrics strip is live on first boot; DMOPS-002 has no source, which is
how you see honest "unavailable" states instead of zeros.

Useful commands: `pnpm test` (the suite doubles as qualification evidence),
`pnpm validation:iq` (checks installed controls against a live database),
`pnpm validation:artifacts` (regenerates the traceability matrix and OQ
report), `pnpm metrics:refresh` (cron-friendly snapshot computation).

## Status

A working slice 11, not a product. What exists: the study registry, the full
DM milestone taxonomy with a role-scoped board and audited writes, a
deliverables surface with eTMF pointers and audited status updates, UAT
cycle and defect tracking with a completion gate ("UAT complete" refuses to
land while defects are open, ADR-0010), eleven qualified metrics flowing
through the adapter pipeline into an immutable snapshot warehouse with trend
and per-site drill-downs, governed re-baselining with an append-only history
(ADR-0009), business-day metric calendars as v1.1 of the elapsed-time
definitions (the version machinery of ADR-0004, exercised once for real),
the CSV + edc-core + GitHub adapters, lock-readiness scoring derived from
the taxonomy's own dependency graph — a per-gate checklist and an unweighted
score with no write path, live signals that never move the score, and a
monthly readiness snapshot (ADR-0014) — and the opt-in stat programming
module: 12 governed STAT milestone codes in an Analysis & Reporting phase,
per-study module opt-in that filters the board and the metrics strip, a
phase-scoped write posture for programmer and biostat seats, the analysis
deliverable types (ADR-0011), and repository work flowing through the same
pipeline: issues, pull requests, and reviews as normalized frames, a
capability-declaring GitHub adapter, the DS metric starter set, and
multi-source studies so an EDC and a repository host can feed one study side
by side (ADR-0012), and training and access mirrors: the LMS transcript and
the source system's access list read through the same adapter contract into
display-only, extract-provenanced mirror tables, a roster that flags active
access with missing, overdue, or expired training, and two roster metrics
that snapshot that answer monthly (ADR-0013), and the portfolio roll-up:
every module's metrics pooled across studies as derived views over the
stored snapshots — ratios and counts pooled exactly from numerators and
denominators, medians served as per-study spreads because a median of
medians is not a median, and the lock-readiness burn-up drawn from the
monthly snapshots (ADR-0015), and the export surface: holiday-aware
business-day calendars as governed files with per-study assignment (the
version story exercised a second time — four definitions bumped), CSV
exports that flatten the same rows the JSON serves under the same
authorization, and the KPI pack, a period-scoped, print-friendly artifact
carrying each metric's registered definition and its checksummed extract
citations (ADR-0016), and the commercial EDC adapters: Medrio, written
strictly from its public OpenAPI document and shipping the honest zero (no
query surface exists in the public spec, so a Medrio-only study computes no
EDC metrics and names every gap), and Medidata Rave, cited against
Medidata's own open-source rwslib because the public RWS documentation is
gone, reconstructing query lifecycles from the ClinicalAuditRecords audit
tape with unknown vocabulary failing loudly instead of being guessed
(ADR-0017), and the per-study visit-date CRF mapping: a Rave study names
in its source config the CRF item and date format that carry its visit
dates, the adapter reads that item's entered values off the audit tape it
already replays, and entry lag lights up as derived — the same
investigation closed Medrio's path as not publicly implementable, its
public API having no surface that reads entered values back (ADR-0018).
What comes next, in no committed order: an LMS adapter (the CSV fixture is
still the only training source), MAuth for Rave, and a native-over-mirrors
cross-source training-gap metric.

This is not validated software. The IQ script, OQ report, and traceability
matrix are generated raw material for a validation program; running that
program is organizational work. See `docs/03-compliance.md`, including its
honest-gaps section.

## License

AGPL-3.0, same as its siblings: anyone can run, study, and improve this, and
nobody can take it closed and sell it back to the teams it serves.
