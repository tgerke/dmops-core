# Operational Qualification report

Environment: commit 92e71f3, node v23.11.0, 2026-07-31T16:58:15.933Z

Suite result: **PASSED** — 152/152 tests passed.

## packages/adapter-contract/src/contract.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | frame schemas (DM-P1: one normalized shape per fact) accepts a conforming query row | 3 |
| PASS | frame schemas (DM-P1: one normalized shape per fact) rejects unknown keys — adapters cannot smuggle source-specific fields | 1 |
| PASS | frame schemas (DM-P1: one normalized shape per fact) rejects non-ISO timestamps | 0 |
| PASS | repository-work frame schemas (ADR-0012) accepts a conforming pull request row and rejects vendor states | 0 |
| PASS | repository-work frame schemas (ADR-0012) requires a submitted timestamp on reviews — pending reviews have no place here | 0 |
| PASS | roster frame schemas (ADR-0013) accepts a conforming training record with dated facts, all nullable | 0 |
| PASS | roster frame schemas (ADR-0013) has no status field — current/overdue/expired is derived in views, never stored | 0 |
| PASS | roster frame schemas (ADR-0013) accepts a conforming access grant and rejects vendor account states | 1 |
| PASS | extraction validation validates rows and row counts together | 1 |
| PASS | extraction validation names the frame, row, and field on failure | 0 |
| PASS | checksum determinism (extract provenance, ADR-0007) is stable across key order | 0 |
| PASS | checksum determinism (extract provenance, ADR-0007) changes when any value changes | 0 |
| PASS | capability gating support (ADR-0005) resolves native, derived, and unsupported fields | 0 |
| PASS | capability gating support (ADR-0005) treats an unsupported frame as unsupported for every field | 0 |
| PASS | capability gating support (ADR-0005) treats an undeclared frame as unsupported | 0 |

## packages/core/src/authz.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | canWriteAnalysis (ADR-0011) DM-P6: programmer and biostat assigned to the study can write analysis-phase work | 1 |
| PASS | canWriteAnalysis (ADR-0011) DM-P5: the posture is study-scoped — the same roles on another study cannot | 0 |
| PASS | canWriteAnalysis (ADR-0011) DM leadership and admin keep their write everywhere the milestone predicate grants it | 0 |
| PASS | canWriteAnalysis (ADR-0011) read seats and the analyst stay out: analysis entry belongs to the analysis team | 0 |
| PASS | canWriteAnalysis (ADR-0011) the analysis deliverable types are exactly the ADR-0011 set; sdtm_spec stays DM | 1 |

## packages/db/src/immutability.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | append-only warehouse and audit trail (DM-P3) rejects UPDATE on audit_event at the database level | 23 |
| PASS | append-only warehouse and audit trail (DM-P3) rejects DELETE on audit_event | 1 |
| PASS | append-only warehouse and audit trail (DM-P3) rejects UPDATE and DELETE on metric_snapshot | 2 |
| PASS | append-only warehouse and audit trail (DM-P3) rejects UPDATE and DELETE on source_extract | 2 |
| PASS | append-only warehouse and audit trail (DM-P3) rejects UPDATE and DELETE on metric_definition (a changed definition is a new version) | 2 |
| PASS | append-only warehouse and audit trail (DM-P3) rejects UPDATE and DELETE on milestone_rebaseline (a re-baseline is history, ADR-0009) | 2 |
| PASS | audit trail (ADR-0003) writes an attributed, chained event for every domain mutation | 4 |
| PASS | audit trail (ADR-0003) verifies clean on untampered data | 2 |
| PASS | audit trail (ADR-0003) detects tampering when a row is altered with triggers disabled | 4 |
| PASS | display-only posture (DM-P4) has no signature columns anywhere in the schema | 4 |
| PASS | display-only posture (DM-P4) stores deliverable evidence as an eTMF pointer, not content | 2 |

## packages/db/src/privileges.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) cannot create tables (no DDL) | 22 |
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) cannot INSERT audit_event directly (cannot fabricate audit) | 2 |
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) cannot TRUNCATE domain tables | 1 |
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) cannot UPDATE or DELETE metric_snapshot even before the trigger fires (DM-P3) | 2 |
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) cannot UPDATE or DELETE milestone_rebaseline even before the trigger fires (ADR-0009) | 2 |
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) cannot write the roster mirrors — display-only, pipeline-written (ADR-0013) | 4 |
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) cannot disable triggers (requires table ownership) | 1 |
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) still audits writes it is allowed to make, attributed via withActor settings | 5 |

## packages/adapters/src/adapters.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | csv adapter (the reference implementation) extracts all four frames from the fixture study and passes contract validation | 5 |
| PASS | csv adapter (the reference implementation) extracts the repository-work frames from the fixture study (ADR-0012) | 1 |
| PASS | csv adapter (the reference implementation) extracts the roster frames from the fixture study (ADR-0013) | 2 |
| PASS | csv adapter (the reference implementation) produces a deterministic checksum for the same fixture (extract provenance) | 1 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) maps query threads to the queries frame, deriving first_response_at from the thread | 8 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) does not pass record creation off as an enrollment date (DM-P1) | 1 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) declares visits unsupported and refuses to extract them (DM-P1: no silent approximation) | 1 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) maps the members listing to current access grants (ADR-0013) | 1 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) declares training unsupported — an EDC is not an LMS (ADR-0013, DM-P1) | 0 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) fails with an actionable message when the key env var is missing | 0 |
| PASS | github adapter (recorded fixtures, ADR-0012) maps issues, filtering out pull requests and following Link pagination | 2 |
| PASS | github adapter (recorded fixtures, ADR-0012) derives the three-valued PR state from GitHub's open|closed plus merged_at | 2 |
| PASS | github adapter (recorded fixtures, ADR-0012) maps submitted reviews and excludes pending ones (no submitted_at to report) | 1 |
| PASS | github adapter (recorded fixtures, ADR-0012) declares EDC frames unsupported and refuses to extract them (DM-P1: no silent approximation) | 0 |
| PASS | github adapter (recorded fixtures, ADR-0012) fails with an actionable message when the token env var is missing | 0 |

## packages/metrics/src/engine.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | metric dictionary (DM-P2) every YAML definition has a registered compute function of the same version, and vice versa | 1 |
| PASS | metric dictionary (DM-P2) definitions carry the full written spec, not a label | 1 |
| PASS | capability gating (DM-P1: skip, never silently approximate) entry_lag is unavailable when the source cannot supply visits.visit_date | 0 |
| PASS | capability gating (DM-P1: skip, never silently approximate) query_tat_median runs on the same source, with derived fields annotated | 0 |
| PASS | capability gating (DM-P1: skip, never silently approximate) milestone_slip and lock_readiness_pct are always available — their source is dmops-core itself | 0 |

## packages/metrics/src/pooling.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | portfolio pooling declarations (ADR-0015) DM-P2: the pooling enumeration covers exactly the governed dictionary — a new metric must declare its portfolio behavior | 16 |
| PASS | portfolio pooling declarations (ADR-0015) an undeclared metric is a hard error, never a silently unpooled card | 0 |

## packages/metrics/src/compute/qualification.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | metric qualification against hand-computed fixtures DM-Q1: query_tat_median v1.0 (calendar days, history-pinned) matches hand-computed truth for DMOPS-001 | 2 |
| PASS | metric qualification against hand-computed fixtures DM-Q2: query_open_aging matches hand-computed truth for DMOPS-001 | 1 |
| PASS | metric qualification against hand-computed fixtures DM-Q3: entry_lag v1.0 (calendar days, history-pinned) matches hand-computed truth for DMOPS-001 | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q5: query_tat_median v1.1 (business days) matches hand-computed truth for DMOPS-001 | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q6: entry_lag v1.1 (business days) matches hand-computed truth for DMOPS-001 | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q5: query_tat_median v1.2 (holiday-aware) matches hand-computed truth under the shipped calendar | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q5: query_tat_median v1.2 with no calendar reproduces the v1.1 weekday-only truth | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q6: entry_lag v1.2 (holiday-aware) matches hand-computed truth under the shipped calendar | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q4: milestone_slip matches hand-computed truth on constructed milestone facts | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q4: milestone_slip returns null with zero records when nothing completed in period | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q9: lock_readiness_pct derives the gate set from the shipped taxonomy and matches hand-computed truth | 12 |
| PASS | metric qualification against hand-computed fixtures DM-Q9: the shipped closure is exactly the eight closeout gates — completing them all scores 100 | 10 |
| PASS | metric qualification against hand-computed fixtures DM-Q9: without definitions there is no checklist — null, never a guessed score | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q7: training_current_pct v1.0 matches hand-computed truth for DMOPS-001 | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q7: training_current_pct returns null with zero records when nothing is required yet | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q8: access_training_gap v1.0 matches hand-computed truth for DMOPS-001 | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q8: access_training_gap counts access with no training on file, and ignores inactive accounts | 0 |
| PASS | DS metric qualification against hand-computed fixtures (stat module, ADR-0012) DS-Q1: pr_review_tat_median v1.0 (business days) matches hand-computed truth for DMOPS-001 | 0 |
| PASS | DS metric qualification against hand-computed fixtures (stat module, ADR-0012) DS-Q2: pr_cycle_time_median v1.0 (business days) matches hand-computed truth for DMOPS-001 | 0 |
| PASS | DS metric qualification against hand-computed fixtures (stat module, ADR-0012) DS-Q1: pr_review_tat_median v1.1 (holiday-aware) matches hand-computed truth under the shipped calendar | 0 |
| PASS | DS metric qualification against hand-computed fixtures (stat module, ADR-0012) DS-Q2: pr_cycle_time_median v1.1 (holiday-aware) matches hand-computed truth under the shipped calendar | 0 |
| PASS | DS metric qualification against hand-computed fixtures (stat module, ADR-0012) DS-Q3: issue_closure_lag_median v1.0 (calendar days) matches hand-computed truth for DMOPS-001 | 0 |
| PASS | DS metric qualification against hand-computed fixtures (stat module, ADR-0012) DS-Q4: issue_open_aging v1.0 matches hand-computed truth for DMOPS-001 | 0 |
| PASS | businessDaysBetween (the v1.1 day-counting rule, ADR-0004) counts weekdays strictly after the start date through the end date | 0 |
| PASS | businessDaysBetween (the v1.1 day-counting rule, ADR-0004) skips weekends: Friday to Monday is one business day | 0 |
| PASS | businessDaysBetween (the v1.1 day-counting rule, ADR-0004) weekend endpoints contribute nothing | 0 |
| PASS | businessDaysBetween (the v1.1 day-counting rule, ADR-0004) same-day is zero and reversed inputs negate | 0 |
| PASS | businessDaysBetween (the v1.1 day-counting rule, ADR-0004) subtracts holiday dates, and a weekend holiday changes nothing (ADR-0016) | 0 |

## apps/api/src/app.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | authentication rejects missing and unknown tokens | 5 |
| PASS | authentication health is public and reports a verified audit chain | 6 |
| PASS | role-scoped views over one set of facts (DM-P5) DM-P5: qa sees the whole portfolio; the sponsor seat sees only its study | 23 |
| PASS | role-scoped views over one set of facts (DM-P5) DM-P5: the sponsor serialization carries no blocker notes; the DM lead's does | 7 |
| PASS | role-scoped views over one set of facts (DM-P5) DM-P6: the board is one read; planned/forecast/actual arrive as the triple, never collapsed | 3 |
| PASS | milestone writes (ADR-0003, ADR-0008) read-only roles cannot write: clinops and sponsor get 403 | 4 |
| PASS | milestone writes (ADR-0003, ADR-0008) the DM lead's write lands, returns the board row, and is audit-attributed to them | 29 |
| PASS | milestone writes (ADR-0003, ADR-0008) ADR-0008: baseline_date and planned_date are not writable through the API | 3 |
| PASS | milestone writes (ADR-0003, ADR-0008) 404s on a milestone occurrence the study does not have | 5 |
| PASS | deliverable surface (ADR-0006) DM-P4: deliverables serve status and an eTMF pointer, never content or signatures | 4 |
| PASS | deliverable surface (ADR-0006) DM-P5: deliverable reads are row-scoped; the sponsor seat sees its study only | 5 |
| PASS | deliverable surface (ADR-0006) DM-P6: read-only roles cannot write deliverable status; the DM lead's write is audit-attributed (ADR-0003) | 20 |
| PASS | deliverable surface (ADR-0006) approving without an approved_date is rejected: approvals are dated facts (ADR-0006) | 6 |
| PASS | deliverable surface (ADR-0006) ADR-0006: identity fields are not writable and unknown fields are rejected | 7 |
| PASS | re-baselining governance (ADR-0009, ADR-0003) re-baselining is above routine edits: dm_lead, clinops, and sponsor get 403 | 7 |
| PASS | re-baselining governance (ADR-0009, ADR-0003) DM-P6: the dm_manager's re-baseline moves planned_date, never baseline_date, and both writes are audit-attributed (ADR-0003) | 34 |
| PASS | re-baselining governance (ADR-0009, ADR-0003) a complete milestone cannot be re-baselined; nor can one with a throwaway reason | 18 |
| PASS | re-baselining governance (ADR-0009, ADR-0003) DM-P5: re-baseline history serves dates to everyone; reasons are omitted from the sponsor serialization | 7 |
| PASS | re-baselining governance (ADR-0009, ADR-0003) 404s on a milestone the study does not have | 4 |
| PASS | UAT cycles and defects (ADR-0010) DM-P4: UAT serves cycle status, counts, and an evidence pointer — never scripts, screenshots, or signatures | 8 |
| PASS | UAT cycles and defects (ADR-0010) DM-P5: defect reads are row-scoped; the sponsor serialization omits resolution notes | 9 |
| PASS | UAT cycles and defects (ADR-0010) DM-P6: the analyst's defect write lands and is audit-attributed (ADR-0003) | 24 |
| PASS | UAT cycles and defects (ADR-0010) read-only roles cannot write UAT: clinops and sponsor get 403; the analyst is study-scoped | 4 |
| PASS | UAT cycles and defects (ADR-0010) UAT.COMPLETE means defects resolved: completing a cycle with open defects is rejected (ADR-0010) | 20 |
| PASS | UAT cycles and defects (ADR-0010) endings are dated facts: resolved without a date and closed without a substantive note are rejected | 5 |
| PASS | UAT cycles and defects (ADR-0010) ADR-0010: identity fields are not writable, and a finished cycle takes no new defects | 3 |
| PASS | stat module (ADR-0011) DM-P5: the board serves analysis rows only where the module is enabled | 4 |
| PASS | stat module (ADR-0011) DM-P6: the programmer's analysis-phase write lands and is audit-attributed (ADR-0003) | 8 |
| PASS | stat module (ADR-0011) DM-P6: the biostatistician writes analysis milestones, but DM-phase milestones stay leadership-only | 10 |
| PASS | stat module (ADR-0011) DM-P6: the analysis posture does not leak sideways — the analyst gets 403 on analysis milestones | 2 |
| PASS | stat module (ADR-0011) analysis deliverable types accept the analysis posture; DM types do not (ADR-0011) | 14 |
| PASS | stat module (ADR-0011) DM-P1: a stat-module study serves the dm set plus the DS starter set (ADR-0012) | 29 |
| PASS | stat module (ADR-0011) DM-P1: the module boundary hides stat metrics from a dm-only study entirely (ADR-0011) | 8 |
| PASS | training and access mirrors (ADR-0013) DM-P1: the roster is mirrored from the source, one row per person, grants aggregated | 3 |
| PASS | training and access mirrors (ADR-0013) training_gap flags the inspection question: expired, overdue, and missing training on active access | 2 |
| PASS | training and access mirrors (ADR-0013) DM-P4: training records serve dated status and provenance, never certificates | 2 |
| PASS | training and access mirrors (ADR-0013) DM-P5: mirror reads are row-scoped; the sponsor sees the roster of its own study | 2 |
| PASS | training and access mirrors (ADR-0013) a study with no roster-capable source serves empty mirrors, not errors | 2 |
| PASS | training and access mirrors (ADR-0013) DM-Q7/DM-Q8: the roster metrics flow through the snapshot pipeline with the fixture truth | 5 |
| PASS | lock-readiness (ADR-0014) DM-P1: the checklist is the depends_on closure of CLOSE.LOCK, derived — never entered | 6 |
| PASS | lock-readiness (ADR-0014) signals ride beside the score and never move it: the score is 0 while the evidence shows live work | 3 |
| PASS | lock-readiness (ADR-0014) DM-P5: the sponsor serialization omits gate blocker notes, and reads are row-scoped | 3 |
| PASS | lock-readiness (ADR-0014) a study with no wired sources serves named absence for signals, not fake zeros (ADR-0005) | 3 |
| PASS | lock-readiness (ADR-0014) DM-Q9: lock_readiness_pct flows through the snapshot pipeline as a dmops-native metric | 5 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P2: every dictionary metric appears with its version and availability | 6 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P1: a study without a source reports adapter metrics unavailable, not zero | 6 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P3: snapshot history is served from immutable rows with extract lineage | 3 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P3: study-grain history spans reporting periods, newest first | 1 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P2: the site drill-down serves the same versioned metric at site grain | 2 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P5: the site drill-down is row-scoped like every other read | 1 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) a study-grain-only metric returns an empty site list, not an error | 1 |
| PASS | portfolio roll-up (ADR-0015) DM-P5: the portfolio is one fact at portfolio grain — portfolio readers see it, study-scoped seats get 403, not a smaller number | 2698 |
| PASS | portfolio roll-up (ADR-0015) DM-P2: every dictionary metric appears once with a declared pooling kind, scoped to the studies that enabled its module | 1214 |
| PASS | portfolio roll-up (ADR-0015) DM-P3: ratio metrics pool exactly from stored numerators and denominators — 0 of 16 lock gates across the portfolio | 2378 |
| PASS | portfolio roll-up (ADR-0015) medians never pool — a named absence with the per-study spread, not a fake portfolio median (ADR-0005) | 2828 |
| PASS | portfolio roll-up (ADR-0015) DM-P1: a metric no source can feed reports its honest scope — one of two studies reporting, pooled over the reporting study only | 1356 |
| PASS | portfolio roll-up (ADR-0015) DM-Q9: the readiness burn-up serves one pooled point per reporting period from the monthly snapshots | 1216 |
| PASS | exports and KPI packs (ADR-0016) DM-P3: the snapshot CSV is the immutable history flattened, provenance columns included | 7 |
| PASS | exports and KPI packs (ADR-0016) DM-P5: the snapshot CSV is row-scoped exactly like the JSON it flattens | 5 |
| PASS | exports and KPI packs (ADR-0016) DM-P5: the portfolio CSV requires portfolio read and keeps the named absences | 1301 |
| PASS | exports and KPI packs (ADR-0016) DM-P2: the pack serves each metric's registered definition at the computed version, with extract citations | 29 |
| PASS | exports and KPI packs (ADR-0016) DM-P2: the pack is period-scoped — May on request, 404 for a period never computed | 23 |
| PASS | exports and KPI packs (ADR-0016) DM-P1/DM-P5: a sourceless study's pack names its absences; the pack is row-scoped | 18 |

Reviewed by: ______________________  Date: ____________
