# Operational Qualification report

Environment: commit 4f42b14, node v23.11.0, 2026-07-30T17:43:31.154Z

Suite result: **PASSED** — 76/76 tests passed.

## packages/adapter-contract/src/contract.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | frame schemas (DM-P1: one normalized shape per fact) accepts a conforming query row | 2 |
| PASS | frame schemas (DM-P1: one normalized shape per fact) rejects unknown keys — adapters cannot smuggle source-specific fields | 1 |
| PASS | frame schemas (DM-P1: one normalized shape per fact) rejects non-ISO timestamps | 0 |
| PASS | extraction validation validates rows and row counts together | 1 |
| PASS | extraction validation names the frame, row, and field on failure | 0 |
| PASS | checksum determinism (extract provenance, ADR-0007) is stable across key order | 0 |
| PASS | checksum determinism (extract provenance, ADR-0007) changes when any value changes | 0 |
| PASS | capability gating support (ADR-0005) resolves native, derived, and unsupported fields | 0 |
| PASS | capability gating support (ADR-0005) treats an unsupported frame as unsupported for every field | 0 |
| PASS | capability gating support (ADR-0005) treats an undeclared frame as unsupported | 0 |

## packages/adapters/src/adapters.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | csv adapter (the reference implementation) extracts all four frames from the fixture study and passes contract validation | 4 |
| PASS | csv adapter (the reference implementation) produces a deterministic checksum for the same fixture (extract provenance) | 0 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) maps query threads to the queries frame, deriving first_response_at from the thread | 2 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) does not pass record creation off as an enrollment date (DM-P1) | 0 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) declares visits unsupported and refuses to extract them (DM-P1: no silent approximation) | 0 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) fails with an actionable message when the key env var is missing | 0 |

## packages/metrics/src/engine.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | metric dictionary (DM-P2) every YAML definition has a registered compute function of the same version, and vice versa | 1 |
| PASS | metric dictionary (DM-P2) definitions carry the full written spec, not a label | 0 |
| PASS | capability gating (DM-P1: skip, never silently approximate) entry_lag is unavailable when the source cannot supply visits.visit_date | 0 |
| PASS | capability gating (DM-P1: skip, never silently approximate) query_tat_median runs on the same source, with derived fields annotated | 0 |
| PASS | capability gating (DM-P1: skip, never silently approximate) milestone_slip is always available — its source is dmops-core itself | 0 |

## packages/db/src/immutability.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | append-only warehouse and audit trail (DM-P3) rejects UPDATE on audit_event at the database level | 23 |
| PASS | append-only warehouse and audit trail (DM-P3) rejects DELETE on audit_event | 1 |
| PASS | append-only warehouse and audit trail (DM-P3) rejects UPDATE and DELETE on metric_snapshot | 2 |
| PASS | append-only warehouse and audit trail (DM-P3) rejects UPDATE and DELETE on source_extract | 2 |
| PASS | append-only warehouse and audit trail (DM-P3) rejects UPDATE and DELETE on metric_definition (a changed definition is a new version) | 2 |
| PASS | append-only warehouse and audit trail (DM-P3) rejects UPDATE and DELETE on milestone_rebaseline (a re-baseline is history, ADR-0009) | 2 |
| PASS | audit trail (ADR-0003) writes an attributed, chained event for every domain mutation | 6 |
| PASS | audit trail (ADR-0003) verifies clean on untampered data | 3 |
| PASS | audit trail (ADR-0003) detects tampering when a row is altered with triggers disabled | 5 |
| PASS | display-only posture (DM-P4) has no signature columns anywhere in the schema | 3 |
| PASS | display-only posture (DM-P4) stores deliverable evidence as an eTMF pointer, not content | 2 |

## packages/db/src/privileges.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) cannot create tables (no DDL) | 22 |
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) cannot INSERT audit_event directly (cannot fabricate audit) | 2 |
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) cannot TRUNCATE domain tables | 1 |
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) cannot UPDATE or DELETE metric_snapshot even before the trigger fires (DM-P3) | 2 |
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) cannot UPDATE or DELETE milestone_rebaseline even before the trigger fires (ADR-0009) | 2 |
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) cannot disable triggers (requires table ownership) | 1 |
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) still audits writes it is allowed to make, attributed via withActor settings | 7 |

## packages/metrics/src/compute/qualification.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | metric qualification against hand-computed fixtures DM-Q1: query_tat_median v1.0 (calendar days, history-pinned) matches hand-computed truth for DMOPS-001 | 1 |
| PASS | metric qualification against hand-computed fixtures DM-Q2: query_open_aging matches hand-computed truth for DMOPS-001 | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q3: entry_lag v1.0 (calendar days, history-pinned) matches hand-computed truth for DMOPS-001 | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q5: query_tat_median v1.1 (business days) matches hand-computed truth for DMOPS-001 | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q6: entry_lag v1.1 (business days) matches hand-computed truth for DMOPS-001 | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q4: milestone_slip matches hand-computed truth on constructed milestone facts | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q4: milestone_slip returns null with zero records when nothing completed in period | 0 |
| PASS | businessDaysBetween (the v1.1 day-counting rule, ADR-0004) counts weekdays strictly after the start date through the end date | 0 |
| PASS | businessDaysBetween (the v1.1 day-counting rule, ADR-0004) skips weekends: Friday to Monday is one business day | 0 |
| PASS | businessDaysBetween (the v1.1 day-counting rule, ADR-0004) weekend endpoints contribute nothing | 0 |
| PASS | businessDaysBetween (the v1.1 day-counting rule, ADR-0004) same-day is zero and reversed inputs negate | 0 |

## apps/api/src/app.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | authentication rejects missing and unknown tokens | 5 |
| PASS | authentication health is public and reports a verified audit chain | 4 |
| PASS | role-scoped views over one set of facts (DM-P5) DM-P5: qa sees the whole portfolio; the sponsor seat sees only its study | 11 |
| PASS | role-scoped views over one set of facts (DM-P5) DM-P5: the sponsor serialization carries no blocker notes; the DM lead's does | 6 |
| PASS | role-scoped views over one set of facts (DM-P5) DM-P6: the board is one read; planned/forecast/actual arrive as the triple, never collapsed | 2 |
| PASS | milestone writes (ADR-0003, ADR-0008) read-only roles cannot write: clinops and sponsor get 403 | 3 |
| PASS | milestone writes (ADR-0003, ADR-0008) the DM lead's write lands, returns the board row, and is audit-attributed to them | 17 |
| PASS | milestone writes (ADR-0003, ADR-0008) ADR-0008: baseline_date and planned_date are not writable through the API | 1 |
| PASS | milestone writes (ADR-0003, ADR-0008) 404s on a milestone occurrence the study does not have | 2 |
| PASS | deliverable surface (ADR-0006) DM-P4: deliverables serve status and an eTMF pointer, never content or signatures | 1 |
| PASS | deliverable surface (ADR-0006) DM-P5: deliverable reads are row-scoped; the sponsor seat sees its study only | 2 |
| PASS | deliverable surface (ADR-0006) DM-P6: read-only roles cannot write deliverable status; the DM lead's write is audit-attributed (ADR-0003) | 9 |
| PASS | deliverable surface (ADR-0006) approving without an approved_date is rejected: approvals are dated facts (ADR-0006) | 2 |
| PASS | deliverable surface (ADR-0006) ADR-0006: identity fields are not writable and unknown fields are rejected | 1 |
| PASS | re-baselining governance (ADR-0009, ADR-0003) re-baselining is above routine edits: dm_lead, clinops, and sponsor get 403 | 2 |
| PASS | re-baselining governance (ADR-0009, ADR-0003) DM-P6: the dm_manager's re-baseline moves planned_date, never baseline_date, and both writes are audit-attributed (ADR-0003) | 9 |
| PASS | re-baselining governance (ADR-0009, ADR-0003) a complete milestone cannot be re-baselined; nor can one with a throwaway reason | 2 |
| PASS | re-baselining governance (ADR-0009, ADR-0003) DM-P5: re-baseline history serves dates to everyone; reasons are omitted from the sponsor serialization | 2 |
| PASS | re-baselining governance (ADR-0009, ADR-0003) 404s on a milestone the study does not have | 1 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P2: every dictionary metric appears with its version and availability | 12 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P1: a study without a source reports adapter metrics unavailable, not zero | 4 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P3: snapshot history is served from immutable rows with extract lineage | 1 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P3: study-grain history spans reporting periods, newest first | 1 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P2: the site drill-down serves the same versioned metric at site grain | 1 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P5: the site drill-down is row-scoped like every other read | 1 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) a study-grain-only metric returns an empty site list, not an error | 1 |

Reviewed by: ______________________  Date: ____________
