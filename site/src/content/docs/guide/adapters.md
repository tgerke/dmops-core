---
title: Adapters
description: Capability-declaring connectors to the systems where data lives
---

dmops-core never asks anyone to retype a number that already exists in the
EDC, the CTMS, the safety database, or the team's repository host. Source
adapters read those systems and return normalized data frames; everything
downstream, from metrics to the board, works from what the adapters honestly
declare they can supply.

## The contract

A source adapter extracts normalized frames from the system where the data
already lives: the EDC frames (`queries`, `subjects`, `visits`, `pages`),
the repository-work frames (`issues`, `pull_requests`, `reviews`,
[ADR-0012](/dmops-core/reference/decisions/0012-programming-work-frames-and-github-adapter/)),
and the roster frames (`training_records`, `access_grants`,
[ADR-0013](/dmops-core/reference/decisions/0013-training-and-access-mirrors/)).
The frames are vocabulary owned by dmops-core, not a mirror of any vendor
payload, and an adapter that does not declare a frame is unsupported for it,
so adding a frame never disturbs existing adapters. The contract
(`@dmops/adapter-contract`) depends only on zod: frame schemas, a capability
model, and a checksum helper so every adapter's extraction provenance is
comparable.

A study can wire more than one source. Each metric is fed by the first
active source whose declared capabilities cover its required fields, so an
EDC supplies the query metrics while a repository host supplies the DS
metrics on the same study.

Adapters are read-only. They never write to the source.

## Capabilities, not optimism

Each adapter declares, per frame and per field, whether its data is `native`
(the source stores exactly this), `derived` (computed, with a note saying
how), or `unsupported`. Metrics gate on these declarations: a metric whose
required field is unsupported is skipped and reported as unavailable with the
named gap
([ADR-0005](/dmops-core/reference/decisions/0005-adapter-capability-contract/)).

![DMOPS-002's metrics strip: three KPI cards report unavailable with the note Skipped, not approximated (ADR-0005), because the study has no active source system](../../../assets/screenshots/metrics-unavailable.png)

This is visible in the demo. edc-core does not expose visit dates through its
API, so its adapter declares `visits` unsupported and the entry-lag metric
reports "unavailable: source 'edc-core' missing visits.visit_date" for
edc-core-sourced studies. That is the correct outcome. A portal that
approximates around source gaps publishes numbers nobody can defend.

## Shipped adapters

- **csv**: reads a directory of CSV fixtures, declares everything native.
  The standalone-demo path and the template to copy.
- **edc-core**: the reference EDC adapter. Authenticates with an edc-core
  study-scoped API key (env indirection, never a key in the database), maps
  query threads to the queries frame, and derives `first_response_at` from
  the first thread message not authored by the query opener. Also supplies
  `access_grants` from the study members listing — current unrevoked human
  grants only — and declares `training_records` unsupported, because an EDC
  is not an LMS
  ([ADR-0013](/dmops-core/reference/decisions/0013-training-and-access-mirrors/)).
- **github**: the repository-host adapter
  ([ADR-0012](/dmops-core/reference/decisions/0012-programming-work-frames-and-github-adapter/)).
  Reads the repositories named in the study's source config (token via env
  indirection, like edc-core) and emits the `issues`, `pull_requests`, and
  `reviews` frames. Every capability claim cites the GitHub documentation
  version and date it was verified against, and the honest wrinkles are
  declared, not papered over: GitHub's own PR state is only open or closed,
  so the three-valued state (open, merged, closed) is `derived` from
  `merged_at`; unsubmitted (pending) reviews carry no timestamp and are
  excluded.
- **medrio**: the first commercial EDC adapter
  ([ADR-0017](/dmops-core/reference/decisions/0017-vendor-adapters-and-evidence-tiers/)),
  written strictly from the public Medrio OpenAPI document, which is the
  only publicly citable Medrio API documentation. Subjects, visits, and
  pages ship with their gaps declared; queries are unsupported because no
  query surface exists in the public spec. A Medrio-only study therefore
  computes zero EDC metrics, and every one reports its named gap. That is
  the fail-closed contract demonstrated on a real vendor, not a defect.
  The one gap that looked closable — visit dates, a study-specific CRF
  variable in Medrio too — stays closed: the public spec's only data-entry
  surfaces are write-only, so no per-study mapping can read the value back
  ([ADR-0018](/dmops-core/reference/decisions/0018-visit-date-crf-mapping/)).
- **rave**: the Medidata Rave adapter
  ([ADR-0017](/dmops-core/reference/decisions/0017-vendor-adapters-and-evidence-tiers/)).
  Medidata's public RWS documentation is no longer reachable, so every
  claim is cited against Medidata's own open-source rwslib client with an
  evidence tier in the header. RWS has no queries dataset; the adapter
  reconstructs query lifecycles by replaying `mdsol:Query` status
  transitions on the ClinicalAuditRecords audit tape, following its cursor
  pagination. The query metrics light up as `derived`; a status value
  outside the publicly known vocabulary fails the extraction with the
  observed value rather than being guessed. Visit dates are study-specific
  CRF items rather than RWS fields, so the study's config names the item
  and its date format (`visitDateItem`); the adapter reads the mapped
  item's entered values off the same audit tape and entry lag lights up as
  `derived`, while an unmapped study keeps reporting `visits.visit_date`
  unsupported
  ([ADR-0018](/dmops-core/reference/decisions/0018-visit-date-crf-mapping/)).

## Writing your own

[Writing an adapter](/dmops-core/guide/writing-an-adapter/) covers the
contract, the three obligations, and the reference implementations. A vendor
adapter PR must cite the vendor documentation it was written against, and
capability claims that cannot be traced to documentation are not merged.
When vendor documentation is not publicly reachable, evidence tiers govern
what ships
([ADR-0017](/dmops-core/reference/decisions/0017-vendor-adapters-and-evidence-tiers/)).
