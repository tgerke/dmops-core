# ADR-0001: dmops-core is the DM PMO layer beside the EDC, never inside it

**Status**: accepted · 2026-07-30

## Decision

dmops-core tracks how Data Management work is planned, executed, evidenced, and
reported: milestones, deliverable status, quality metrics, and (later) UAT and
lock readiness. It never captures clinical data, never issues or resolves
queries, and never holds the approval record for a document. Data that already
lives in the EDC, CTMS, eTMF, or LMS is read through source adapters; data that
lives nowhere else is owned here outright, and no parallel tracker is permitted.

## Rationale

DM teams re-assemble status by hand for every governance meeting because the
operational load — database build, edit checks, UAT, reconciliation, lock
readiness — is invisible to ClinOps, Biostats, and sponsors. The failure mode
that kills status portals is dual entry: the moment a DM lead retypes a number
that exists in the EDC, the portal starts lying. Every field is auto-derived or
authoritative, never both.

## Consequences

- The scope boundary is structural: no clinical-data tables, no query workflow,
  no document content, no signature columns (ADR-0006).
- The integration surface is read-mostly adapters (ADR-0005) plus outbound
  links to the systems that own the records.
- Milestone dates and deliverable status, which exist nowhere else, are owned
  and audited here (ADR-0003).
