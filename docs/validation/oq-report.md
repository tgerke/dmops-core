# Operational Qualification report

Environment: commit 8fb43b7, node v23.11.0, 2026-08-03T14:38:38.146Z

Suite result: **PASSED** — 186/186 tests passed.

## packages/adapter-contract/src/contract.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | frame schemas (DM-P1: one normalized shape per fact) accepts a conforming query row | 2 |
| PASS | frame schemas (DM-P1: one normalized shape per fact) rejects unknown keys — adapters cannot smuggle source-specific fields | 1 |
| PASS | frame schemas (DM-P1: one normalized shape per fact) rejects non-ISO timestamps | 0 |
| PASS | repository-work frame schemas (ADR-0012) accepts a conforming pull request row and rejects vendor states | 0 |
| PASS | repository-work frame schemas (ADR-0012) requires a submitted timestamp on reviews — pending reviews have no place here | 0 |
| PASS | roster frame schemas (ADR-0013) accepts a conforming training record with dated facts, all nullable | 0 |
| PASS | roster frame schemas (ADR-0013) has no status field — current/overdue/expired is derived in views, never stored | 0 |
| PASS | roster frame schemas (ADR-0013) accepts a conforming access grant and rejects vendor account states | 0 |
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
| PASS | csv adapter (the reference implementation) extracts all four frames from the fixture study and passes contract validation | 8 |
| PASS | csv adapter (the reference implementation) extracts the repository-work frames from the fixture study (ADR-0012) | 1 |
| PASS | csv adapter (the reference implementation) extracts the roster frames from the fixture study (ADR-0013) | 1 |
| PASS | csv adapter (the reference implementation) produces a deterministic checksum for the same fixture (extract provenance) | 0 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) maps query threads to the queries frame, deriving first_response_at from the thread | 3 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) does not pass record creation off as an enrollment date (DM-P1) | 0 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) declares visits unsupported and refuses to extract them (DM-P1: no silent approximation) | 0 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) maps the members listing to current access grants (ADR-0013) | 0 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) declares training unsupported — an EDC is not an LMS (ADR-0013, DM-P1) | 0 |
| PASS | edc-core adapter (reference EDC, recorded fixtures) fails with an actionable message when the key env var is missing | 0 |
| PASS | github adapter (recorded fixtures, ADR-0012) maps issues, filtering out pull requests and following Link pagination | 1 |
| PASS | github adapter (recorded fixtures, ADR-0012) derives the three-valued PR state from GitHub's open|closed plus merged_at | 0 |
| PASS | github adapter (recorded fixtures, ADR-0012) maps submitted reviews and excludes pending ones (no submitted_at to report) | 2 |
| PASS | github adapter (recorded fixtures, ADR-0012) declares EDC frames unsupported and refuses to extract them (DM-P1: no silent approximation) | 0 |
| PASS | github adapter (recorded fixtures, ADR-0012) fails with an actionable message when the token env var is missing | 0 |
| PASS | medrio adapter (recorded fixtures, ADR-0017) maps subjects through the study-configured statusMap and never emits PII (DM-P1) | 1 |
| PASS | medrio adapter (recorded fixtures, ADR-0017) dedupes visit instances and derives page status without claiming complete (DM-P1) | 0 |
| PASS | medrio adapter (recorded fixtures, ADR-0017) fails loudly on a subject status with no statusMap entry (ADR-0017) | 0 |
| PASS | medrio adapter (recorded fixtures, ADR-0017) surfaces the envelope's processMessage when a call is not processed | 0 |
| PASS | medrio adapter (recorded fixtures, ADR-0017) declares queries unsupported — the public Medrio API has no query surface (DM-P1: no silent approximation) | 0 |
| PASS | medrio adapter (recorded fixtures, ADR-0017) fails with an actionable message when a credential env var is missing | 0 |
| PASS | rave adapter (recorded fixtures, ADR-0017) reconstructs query lifecycles from the audit tape, following the Link cursor | 5 |
| PASS | rave adapter (recorded fixtures, ADR-0017) derives visits and pages from Entered audit events, stamping undeclared offsets as Z (declared assumption, DM-P1) | 1 |
| PASS | rave adapter (recorded fixtures, ADR-0017) maps the subjects listing through statusMap and SiteRef (ADR-0017) | 0 |
| PASS | rave adapter (recorded fixtures, ADR-0017) fails loudly on a query status outside the public vocabulary (ADR-0017, DM-P1: no silent approximation) | 0 |
| PASS | rave adapter (recorded fixtures, ADR-0017) fails loudly when a subject carries no readable workflow status (ADR-0017) | 1 |
| PASS | rave adapter (recorded fixtures, ADR-0017) declares repository frames unsupported and refuses to extract them (DM-P1: no silent approximation) | 0 |
| PASS | rave adapter (recorded fixtures, ADR-0017) fails with an actionable message when a credential env var is missing | 0 |
| PASS | rave adapter (recorded fixtures, ADR-0017) visit_date is derived only when config maps the study's CRF item (ADR-0018) | 0 |
| PASS | rave adapter (recorded fixtures, ADR-0017) reads the mapped item's value off the audit tape, last observation winning (ADR-0018) | 1 |
| PASS | rave adapter (recorded fixtures, ADR-0017) leaves visit_date null on the same tape when no mapping is configured (ADR-0018) | 0 |
| PASS | rave adapter (recorded fixtures, ADR-0017) fails loudly when a value does not parse under the declared dateFormat (ADR-0017/ADR-0018) | 0 |
| PASS | vault-training adapter (recorded fixtures, ADR-0020) maps the transcript through the tenant stateMap, following next_page (ADR-0020) | 1 |
| PASS | vault-training adapter (recorded fixtures, ADR-0020) omitting studyField mirrors the whole vault — the org-wide training posture (ADR-0020) | 0 |
| PASS | vault-training adapter (recorded fixtures, ADR-0020) fails loudly on a lifecycle state with no stateMap entry (ADR-0020) | 0 |
| PASS | vault-training adapter (recorded fixtures, ADR-0020) fails loudly when the email path resolves nothing — never an anonymous transcript row (ADR-0020) | 0 |
| PASS | vault-training adapter (recorded fixtures, ADR-0020) surfaces Vault's own error detail when a query is not successful | 0 |
| PASS | vault-training adapter (recorded fixtures, ADR-0020) declares only the transcript — access_grants audits the wrong door (ADR-0020, DM-P1) | 0 |
| PASS | vault-training adapter (recorded fixtures, ADR-0020) refuses a source_study_key it would have to escape into VQL | 0 |
| PASS | vault-training adapter (recorded fixtures, ADR-0020) fails with an actionable message when a credential env var is missing | 0 |

## packages/core/src/authz.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | canWriteAnalysis (ADR-0011) DM-P6: programmer and biostat assigned to the study can write analysis-phase work | 1 |
| PASS | canWriteAnalysis (ADR-0011) DM-P5: the posture is study-scoped — the same roles on another study cannot | 0 |
| PASS | canWriteAnalysis (ADR-0011) DM leadership and admin keep their write everywhere the milestone predicate grants it | 0 |
| PASS | canWriteAnalysis (ADR-0011) read seats and the analyst stay out: analysis entry belongs to the analysis team | 0 |
| PASS | canWriteAnalysis (ADR-0011) the analysis deliverable types are exactly the ADR-0011 set; sdtm_spec stays DM | 0 |

## packages/db/src/immutability.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | append-only warehouse and audit trail (DM-P3) rejects UPDATE on audit_event at the database level | 27 |
| PASS | append-only warehouse and audit trail (DM-P3) rejects DELETE on audit_event | 1 |
| PASS | append-only warehouse and audit trail (DM-P3) rejects UPDATE and DELETE on metric_snapshot | 3 |
| PASS | append-only warehouse and audit trail (DM-P3) rejects UPDATE and DELETE on source_extract | 2 |
| PASS | append-only warehouse and audit trail (DM-P3) rejects UPDATE and DELETE on metric_definition (a changed definition is a new version) | 2 |
| PASS | append-only warehouse and audit trail (DM-P3) rejects UPDATE and DELETE on milestone_rebaseline (a re-baseline is history, ADR-0009) | 2 |
| PASS | audit trail (ADR-0003) writes an attributed, chained event for every domain mutation | 7 |
| PASS | audit trail (ADR-0003) verifies clean on untampered data | 4 |
| PASS | audit trail (ADR-0003) detects tampering when a row is altered with triggers disabled | 7 |
| PASS | display-only posture (DM-P4) has no signature columns anywhere in the schema | 5 |
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
| PASS | runtime role privilege ceilings (ADR-0003, DM-P3) still audits writes it is allowed to make, attributed via withActor settings | 7 |

## packages/metrics/src/engine.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | metric dictionary (DM-P2) every YAML definition has a registered compute function of the same version, and vice versa | 1 |
| PASS | metric dictionary (DM-P2) definitions carry the full written spec, not a label | 1 |
| PASS | capability gating (DM-P1: skip, never silently approximate) entry_lag is unavailable when the source cannot supply visits.visit_date | 0 |
| PASS | capability gating (DM-P1: skip, never silently approximate) query_tat_median runs on the same source, with derived fields annotated | 0 |
| PASS | capability gating (DM-P1: skip, never silently approximate) milestone_slip and lock_readiness_pct are always available — their source is dmops-core itself | 0 |
| PASS | capability gating (DM-P1: skip, never silently approximate) the medrio adapter's honest capabilities gate off the whole EDC metric set with named gaps (ADR-0017, DM-P1) | 0 |
| PASS | capability gating (DM-P1: skip, never silently approximate) the rave adapter lights the query metrics as derived and keeps entry_lag off (ADR-0017, DM-P1) | 0 |
| PASS | capability gating (DM-P1: skip, never silently approximate) input 'mirrors' is declared only by the mirror frames' metric (ADR-0019) | 0 |
| PASS | capability gating (DM-P1: skip, never silently approximate) a visit-date CRF mapping in the source config lights entry_lag as derived (ADR-0018, DM-P1) | 0 |
| PASS | mirror-fed availability (ADR-0019, DM-P1) a split deployment — access from edc-core, training from Vault Training — feeds the metric across sources (ADR-0020) | 0 |
| PASS | mirror-fed availability (ADR-0019, DM-P1) an EDC alone leaves the training frame with no feeder, and the gap is named | 0 |
| PASS | mirror-fed availability (ADR-0019, DM-P1) a single source covering both frames still feeds the metric — the demo posture | 0 |
| PASS | mirror-fed availability (ADR-0019, DM-P1) a feeder that supports the frame but not a required field is a named gap, not an approximation | 0 |

## packages/metrics/src/pooling.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | portfolio pooling declarations (ADR-0015) DM-P2: the pooling enumeration covers exactly the governed dictionary — a new metric must declare its portfolio behavior | 14 |
| PASS | portfolio pooling declarations (ADR-0015) an undeclared metric is a hard error, never a silently unpooled card | 0 |

## packages/metrics/src/compute/qualification.test.ts

| Result | Test | ms |
| --- | --- | ---: |
| PASS | metric qualification against hand-computed fixtures DM-Q1: query_tat_median v1.0 (calendar days, history-pinned) matches hand-computed truth for DMOPS-001 | 1 |
| PASS | metric qualification against hand-computed fixtures DM-Q2: query_open_aging matches hand-computed truth for DMOPS-001 | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q3: entry_lag v1.0 (calendar days, history-pinned) matches hand-computed truth for DMOPS-001 | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q5: query_tat_median v1.1 (business days) matches hand-computed truth for DMOPS-001 | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q6: entry_lag v1.1 (business days) matches hand-computed truth for DMOPS-001 | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q5: query_tat_median v1.2 (holiday-aware) matches hand-computed truth under the shipped calendar | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q5: query_tat_median v1.2 with no calendar reproduces the v1.1 weekday-only truth | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q6: entry_lag v1.2 (holiday-aware) matches hand-computed truth under the shipped calendar | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q4: milestone_slip matches hand-computed truth on constructed milestone facts | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q4: milestone_slip returns null with zero records when nothing completed in period | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q9: lock_readiness_pct derives the gate set from the shipped taxonomy and matches hand-computed truth | 8 |
| PASS | metric qualification against hand-computed fixtures DM-Q9: the shipped closure is exactly the eight closeout gates — completing them all scores 100 | 4 |
| PASS | metric qualification against hand-computed fixtures DM-Q9: without definitions there is no checklist — null, never a guessed score | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q7: training_current_pct v1.0 matches hand-computed truth for DMOPS-001 | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q7: training_current_pct returns null with zero records when nothing is required yet | 0 |
| PASS | metric qualification against hand-computed fixtures DM-Q8: access_training_gap v1.0/v2.0 matches hand-computed truth for DMOPS-001 (v2.0 changed sourcing, not math — ADR-0019) | 0 |
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
| PASS | authentication rejects missing and unknown tokens | 4 |
| PASS | authentication health is public and reports a verified audit chain | 9 |
| PASS | role-scoped views over one set of facts (DM-P5) DM-P5: qa sees the whole portfolio; the sponsor seat sees only its study | 23 |
| PASS | role-scoped views over one set of facts (DM-P5) DM-P5: the sponsor serialization carries no blocker notes; the DM lead's does | 6 |
| PASS | role-scoped views over one set of facts (DM-P5) DM-P6: the board is one read; planned/forecast/actual arrive as the triple, never collapsed | 3 |
| PASS | milestone writes (ADR-0003, ADR-0008) read-only roles cannot write: clinops and sponsor get 403 | 4 |
| PASS | milestone writes (ADR-0003, ADR-0008) the DM lead's write lands, returns the board row, and is audit-attributed to them | 21 |
| PASS | milestone writes (ADR-0003, ADR-0008) ADR-0008: baseline_date and planned_date are not writable through the API | 1 |
| PASS | milestone writes (ADR-0003, ADR-0008) 404s on a milestone occurrence the study does not have | 2 |
| PASS | deliverable surface (ADR-0006) DM-P4: deliverables serve status and an eTMF pointer, never content or signatures | 2 |
| PASS | deliverable surface (ADR-0006) DM-P5: deliverable reads are row-scoped; the sponsor seat sees its study only | 2 |
| PASS | deliverable surface (ADR-0006) DM-P6: read-only roles cannot write deliverable status; the DM lead's write is audit-attributed (ADR-0003) | 11 |
| PASS | deliverable surface (ADR-0006) approving without an approved_date is rejected: approvals are dated facts (ADR-0006) | 3 |
| PASS | deliverable surface (ADR-0006) ADR-0006: identity fields are not writable and unknown fields are rejected | 2 |
| PASS | re-baselining governance (ADR-0009, ADR-0003) re-baselining is above routine edits: dm_lead, clinops, and sponsor get 403 | 2 |
| PASS | re-baselining governance (ADR-0009, ADR-0003) DM-P6: the dm_manager's re-baseline moves planned_date, never baseline_date, and both writes are audit-attributed (ADR-0003) | 11 |
| PASS | re-baselining governance (ADR-0009, ADR-0003) a complete milestone cannot be re-baselined; nor can one with a throwaway reason | 2 |
| PASS | re-baselining governance (ADR-0009, ADR-0003) DM-P5: re-baseline history serves dates to everyone; reasons are omitted from the sponsor serialization | 2 |
| PASS | re-baselining governance (ADR-0009, ADR-0003) 404s on a milestone the study does not have | 1 |
| PASS | UAT cycles and defects (ADR-0010) DM-P4: UAT serves cycle status, counts, and an evidence pointer — never scripts, screenshots, or signatures | 3 |
| PASS | UAT cycles and defects (ADR-0010) DM-P5: defect reads are row-scoped; the sponsor serialization omits resolution notes | 3 |
| PASS | UAT cycles and defects (ADR-0010) DM-P6: the analyst's defect write lands and is audit-attributed (ADR-0003) | 10 |
| PASS | UAT cycles and defects (ADR-0010) read-only roles cannot write UAT: clinops and sponsor get 403; the analyst is study-scoped | 2 |
| PASS | UAT cycles and defects (ADR-0010) UAT.COMPLETE means defects resolved: completing a cycle with open defects is rejected (ADR-0010) | 14 |
| PASS | UAT cycles and defects (ADR-0010) endings are dated facts: resolved without a date and closed without a substantive note are rejected | 4 |
| PASS | UAT cycles and defects (ADR-0010) ADR-0010: identity fields are not writable, and a finished cycle takes no new defects | 2 |
| PASS | stat module (ADR-0011) DM-P5: the board serves analysis rows only where the module is enabled | 4 |
| PASS | stat module (ADR-0011) DM-P6: the programmer's analysis-phase write lands and is audit-attributed (ADR-0003) | 5 |
| PASS | stat module (ADR-0011) DM-P6: the biostatistician writes analysis milestones, but DM-phase milestones stay leadership-only | 6 |
| PASS | stat module (ADR-0011) DM-P6: the analysis posture does not leak sideways — the analyst gets 403 on analysis milestones | 1 |
| PASS | stat module (ADR-0011) analysis deliverable types accept the analysis posture; DM types do not (ADR-0011) | 5 |
| PASS | stat module (ADR-0011) DM-P1: a stat-module study serves the dm set plus the DS starter set (ADR-0012) | 21 |
| PASS | stat module (ADR-0011) DM-P1: the module boundary hides stat metrics from a dm-only study entirely (ADR-0011) | 5 |
| PASS | training and access mirrors (ADR-0013) DM-P1: the roster is mirrored from the source, one row per person, grants aggregated | 2 |
| PASS | training and access mirrors (ADR-0013) training_gap flags the inspection question: expired, overdue, and missing training on active access | 1 |
| PASS | training and access mirrors (ADR-0013) DM-P4: training records serve dated status and provenance, never certificates | 2 |
| PASS | training and access mirrors (ADR-0013) DM-P5: mirror reads are row-scoped; the sponsor sees the roster of its own study | 2 |
| PASS | training and access mirrors (ADR-0013) a study with no roster-capable source serves empty mirrors, not errors | 2 |
| PASS | training and access mirrors (ADR-0013) DM-Q7/DM-Q8: the roster metrics flow through the snapshot pipeline with the fixture truth | 5 |
| PASS | lock-readiness (ADR-0014) DM-P1: the checklist is the depends_on closure of CLOSE.LOCK, derived — never entered | 5 |
| PASS | lock-readiness (ADR-0014) signals ride beside the score and never move it: the score is 0 while the evidence shows live work | 3 |
| PASS | lock-readiness (ADR-0014) DM-P5: the sponsor serialization omits gate blocker notes, and reads are row-scoped | 3 |
| PASS | lock-readiness (ADR-0014) a study with no wired sources serves named absence for signals, not fake zeros (ADR-0005) | 3 |
| PASS | lock-readiness (ADR-0014) DM-Q9: lock_readiness_pct flows through the snapshot pipeline as a dmops-native metric | 5 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P2: every dictionary metric appears with its version and availability | 4 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P1: a study without a source reports adapter metrics unavailable, not zero | 4 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P1: an EDC-only study names the training frame's missing feeder for the mirror-fed metric (ADR-0019) | 7 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P3: snapshot history is served from immutable rows with extract lineage | 1 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P3: study-grain history spans reporting periods, newest first | 1 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P2: the site drill-down serves the same versioned metric at site grain | 1 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) DM-P5: the site drill-down is row-scoped like every other read | 0 |
| PASS | metrics surface (DM-P1, DM-P2, DM-P3) a study-grain-only metric returns an empty site list, not an error | 1 |
| PASS | portfolio roll-up (ADR-0015) DM-P5: the portfolio is one fact at portfolio grain — portfolio readers see it, study-scoped seats get 403, not a smaller number | 272 |
| PASS | portfolio roll-up (ADR-0015) DM-P2: every dictionary metric appears once with a declared pooling kind, scoped to the studies that enabled its module | 117 |
| PASS | portfolio roll-up (ADR-0015) DM-P3: ratio metrics pool exactly from stored numerators and denominators — 0 of 16 lock gates across the portfolio | 228 |
| PASS | portfolio roll-up (ADR-0015) medians never pool — a named absence with the per-study spread, not a fake portfolio median (ADR-0005) | 230 |
| PASS | portfolio roll-up (ADR-0015) DM-P1: a metric no source can feed reports its honest scope — one of two studies reporting, pooled over the reporting study only | 116 |
| PASS | portfolio roll-up (ADR-0015) DM-Q9: the readiness burn-up serves one pooled point per reporting period from the monthly snapshots | 118 |
| PASS | exports and KPI packs (ADR-0016) DM-P3: the snapshot CSV is the immutable history flattened, provenance columns included | 5 |
| PASS | exports and KPI packs (ADR-0016) DM-P5: the snapshot CSV is row-scoped exactly like the JSON it flattens | 4 |
| PASS | exports and KPI packs (ADR-0016) DM-P5: the portfolio CSV requires portfolio read and keeps the named absences | 163 |
| PASS | exports and KPI packs (ADR-0016) DM-P2: the pack serves each metric's registered definition at the computed version, with extract citations | 27 |
| PASS | exports and KPI packs (ADR-0016) DM-P2: the pack is period-scoped — May on request, 404 for a period never computed | 14 |
| PASS | exports and KPI packs (ADR-0016) DM-P1/DM-P5: a sourceless study's pack names its absences; the pack is row-scoped | 8 |

Reviewed by: ______________________  Date: ____________
