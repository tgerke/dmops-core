---
title: dmops-core
description: The DM PMO layer beside the EDC
---

dmops-core is the system of record for how clinical Data Management work is
planned, executed, evidenced, and reported. It sits beside the EDC, never
inside it: milestone boards, deliverable status with eTMF links, and quality
metrics computed from source systems through capability-declaring adapters.

The problem it addresses is familiar to every DM team. Database build,
edit-check specification, UAT, external data reconciliation, coding, and lock
readiness are tracked in spreadsheets, email threads, and tribal memory.
ClinOps, Biostats, and sponsors cannot self-serve the answer to "where is the
database build?", so status is re-assembled by hand for every governance
meeting, and quality metrics are recomputed inconsistently and argued about.

dmops-core makes DM's work legible to every other domain without adding a
second data-entry burden to DM. If a fact lives in the EDC, an adapter reads
it. If it lives nowhere else, this system owns it, audits it, and shows one
version of it to every audience.

It is the third sibling of [edc-core](https://github.com/tgerke/edc-core) and
[ctms-core](https://github.com/tgerke/ctms-core), sharing their architecture:
compliance enforced by the database, derived-over-stored status, validation
evidence generated from live runs, and integration over plain HTTP.

Start with [Getting started](/dmops-core/getting-started/), then the guide
pages on [milestones](/dmops-core/milestones/), [metrics](/dmops-core/metrics/),
[adapters](/dmops-core/adapters/), and [compliance](/dmops-core/compliance/).
