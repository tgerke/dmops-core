# ADR-0013: Training and access status arrive as mirrored frames, never as records this system owns

**Status**: accepted · 2026-07-30

## Decision

The adapter contract gains two normalized frames: `training_records` and
`access_grants`. A training record carries a person key, a course key and
title, and the assignment's dated facts — due, completed, expires. An access
grant carries a person key, a role key, an optional site key, an account
status (`active`, `locked`, `deactivated`), and when it was granted. Both are
dmops-core vocabulary, not an LMS or EDC payload shape, exactly as `queries`
is not a Medrio or Rave shape (ADR-0012).

Unlike the metric frames, these two also persist: each refresh replaces the
study's rows in two mirror tables, `training_mirror` and `access_mirror`,
stamped with the `source_extract` that produced them. The mirrors are the
displayed roster. They follow ADR-0006 to the letter — the LMS holds the
training record, the source system's user administration holds the grant;
dmops-core shows current status with provenance and holds nothing anyone
could sign. Three structural consequences:

- **The API role cannot write them.** `dmops_app` gets SELECT only. Mirror
  rows are written by the refresh pipeline running as the owning role, the
  same posture as the metric warehouse. There is no endpoint that could
  hand-edit a training status, so there is nothing to policy away (DM-P1: a
  fact that lives in the LMS is never also entered here).
- **They are not audited.** A mirror is machine state, replaced wholesale
  each refresh; its provenance is the checksummed extract it cites, the same
  exemption `metric_snapshot` and `source_extract` already carry. The
  source system audits the underlying grants and completions.
- **They are not identity-resolved.** `person_key` is the source system's
  identity — by convention an email address, which is what makes the
  training and access mirrors joinable to each other when they come from
  different sources. There is no foreign key to `person`: site staff hold
  EDC accounts without being portal users, and inventing person rows for
  them would make this system a shadow directory.

Statuses are derived in views, never stored (house rule): a training row is
`current`, `expired`, `overdue`, or `pending` as a function of its dates and
the day you ask; `v_study_access_roster` joins the two mirrors per person and
flags the inspection question directly — active access with training that is
missing, overdue, or expired.

The `access_grants` frame is a mirror of *current* grants. edc-core's
membership listing returns unrevoked grants only (revocation history stays in
the EDC's own audit trail), and a roster is a statement about now; adapters
whose sources expose grant history still emit only the current state. The
edc-core adapter implements the frame — person, name, role, site, status,
and granted-at are read from its documented members endpoint (consulted in
the edc-core repository, 2026-07-30) — and declares `training_records`
unsupported: an EDC is not an LMS. The csv fixture adapter carries both
frames, as it does every frame; a real LMS adapter is future work on the same
contract. The GitHub adapter is untouched — capabilities fail closed
(ADR-0005), so both frames are `unsupported` there by omission.

Two metrics, both `module: dm`, `grain: [study]`, with qualification tokens
continuing the DM series:

- `training_current_pct` (DM-Q7): of training assignments due by period end,
  the percent completed and unexpired as of period end
  (`training_records`).
- `access_training_gap` (DM-Q8): count of persons holding an active access
  grant at period end whose training shows a gap — an assignment overdue, a
  completion expired, or no training on file at all (`access_grants` +
  `training_records`).

## Rationale

Training-before-access is the delegation question every GCP inspection asks,
and today it is answered by exporting the EDC user list and the LMS
transcript into a spreadsheet and eyeballing the join. Both facts already
live in systems with APIs; reading them through the adapter contract is
DM-P1 applied to people instead of data points. The mirror tables exist
because a roster is row-level display, which metric snapshots cannot serve —
but the write path, provenance, and privilege posture are the warehouse's,
so the display layer never becomes a second source of truth.

Replace-on-refresh rather than append is deliberate: history of *what the
roster looked like* is not this system's question — the snapshot warehouse
keeps the monthly compliance numbers, and the source systems keep the grant
and completion history. An append-only mirror would be a slowly growing copy
of someone else's audit trail, which ADR-0006 exists to prevent.

`access_training_gap` needs both frames from one source, because the
pipeline feeds each metric from a single extraction (ADR-0012). In the demo
the csv adapter covers both; in a split deployment — access from the EDC,
training from an LMS — the metric reports unavailable with the named gap,
honestly, while the roster view still answers the question live, because the
view joins the mirrors regardless of which source fed each. A cross-source
compute over the mirrors themselves (the `milestone_slip` pattern) is the
named v2 path if the snapshot trend is wanted in split deployments.

## Consequences

- Migration 0006 adds the mirrors, the `access_status` enum, the roster and
  training-status views, and the SELECT-only grants; the mirror tables join
  `iq.ts` AUDIT_EXEMPT with the same justification as the warehouse tables.
- `refreshStudyMetrics` mirrors the two frames from the first active source
  whose capabilities support them, sharing the extraction (and the
  `source_extract` row) with any metrics that source feeds.
- The qualification-token list in `tools/validation-artifacts.ts` gains
  DM-Q7 and DM-Q8; fixtures stay hand-computed
  (`fixtures/study-DMOPS-001/expected-values.json`).
- The roster serializes identically for every role, sponsors included: it
  contains status and dates only, and a sponsor auditing its CRO's training
  compliance is the use case, not a leak. Field-level per-sponsor ACL
  remains the deferred slice it has been since ADR-0009.
- `REL.TRAIN` and `REL.ACCESS` stay milestone assertions by DM leadership;
  the mirrors are the evidence beside the assertion, not a replacement for
  it.
