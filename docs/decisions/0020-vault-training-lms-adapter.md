# ADR-0020: The first LMS adapter reads Veeva Vault Training

**Status**: accepted · 2026-08-03

## Decision

The LMS adapter deferred since ADR-0013 ships as `vault-training`, reading
Veeva Vault Training through the public Vault Platform API. It implements the
`training_records` frame and nothing else; every other frame stays
undeclared, which is fail-closed doing its job (ADR-0005). Evidence tiers per
ADR-0017, all accessed 2026-08-03:

- **[P] The platform surface.** Session auth (`POST /api/{version}/auth`,
  form-encoded, `sessionId` presented in the `Authorization` header), the
  VQL query endpoint (`POST /api/{version}/query`, the query as the `q`
  form parameter, `next_page` pagination in `responseDetails`), and VQL
  itself — relationship traversal through `__vr` dot notation and column
  aliases (`AS`) — are documented on developer.veevavault.com (API v25.1
  reference and the VQL guide).
- **[P] The object surface.** `training_assignment__v` and its field API
  names — `due_date__v`, `assigned_date__v`, `completion_date__v`,
  `state__v`, `learner__v`, `training_requirement__v` — are documented on
  Veeva's vendor-hosted Vault Training help (Importing Training
  Assignments, Training Recurrence, Training Automation pages at
  quality.veevavault.help).
- **[NC] Two tenant vocabularies**, handled the ADR-0017 way — explicit
  configuration, unknowns failing loudly, never a guess:
  1. The full set of `state__v` lifecycle values is not publicly
     enumerated (help names Created, Assigned, Cancelled, Completed,
     Pending Substitute Completion, and an optional Resolved in prose, and
     lifecycles are tenant-configurable). Config carries a `stateMap` from
     observed values to `required` or `excluded`; an unmapped value fails
     the extraction with the observed value in the message.
  2. The learner's email. Help documents that a Training Assignment's
     Learner is a Person record referencing a unique User, but the Person
     object's field API names are not publicly enumerated. Config carries
     `learnerEmailPath`, a VQL relationship path from the assignment to the
     email (for example `learner__vr.email__sys`), validated as a plain dot
     path; a row whose path yields no email fails the extraction. The path
     is operator-verified per tenant against the documented object metadata
     API — a config entry made with the real field name in hand, by design.

Two postures in the capability declaration are the decisions worth recording:

1. **`expires_date` is derived, and constantly null.** Vault Training has no
   expiry on a completion: recurrence reissues training as a new assignment
   with its own due date (relative or absolute, per the Training Recurrence
   help), so the next requirement arrives as a new row rather than an
   expiry on the old one. Null is the true value under that model, not a
   missing one — the metric's "no expiry date" branch (ADR-0013) is exactly
   this semantic, and a recurring obligation still surfaces because the new
   assignment's `due_date` starts the clock again. This is the opposite of
   Medrio's `first_entered_at` (ADR-0017), where the fact exists in the
   world and the API withholds it: there the honest word is `unsupported`;
   here the source's own model says the fact is null.
2. **`access_grants` stays undeclared.** Vault's user administration
   governs access to Vault, not to the system under access review. The
   access mirror keeps coming from the EDC (or whichever source holds the
   grants); the LMS brings the transcript. Declaring Vault users as access
   grants would make the gap metric audit the wrong door.

Study scoping is config: a Study Training vault names the assignment field
that carries its study (`studyField`), and the extraction filters
`WHERE {studyField} = '{source_study_key}'`; a Quality vault running
organization-wide GCP training omits it, and the whole transcript is the
study's transcript. Rows whose mapped state is `excluded` (cancelled and
kin) never enter the frame — a withdrawn requirement is not a training gap.

## Rationale

ADR-0019 built the machinery whose payoff is this adapter: the mirror-fed
gap metric computes the moment an LMS exists, and until now the CSV fixture
was the only training source. The vendor survey (2026-08-03) ran the
ADR-0017 evidence bar over the clinical-training field: UL ComplianceWire
publishes no API documentation publicly; SAP Litmos gates its developer
documentation behind a customer login (its help-center articles are
reachable, but the API reference itself is not); TalentLMS publishes a full
public API but is a general-purpose corporate LMS with no assignment
due-date concept, which would leave `training_current_pct` gated off.
Veeva publishes both the platform API and the Training object surface on
vendor-hosted, login-free pages, and Vault Training — Study Training in
particular — is aimed at exactly the population this product's roster
audits: site staff and study teams under GCP training obligations, in the
same product family as the eTMF this portal already links toward. Strongest
public evidence and closest domain fit landed on the same vendor.

The two [NC] configs follow the Medrio `statusMap` precedent deliberately.
Vault lifecycles and Person objects are tenant-configurable; hardcoding
either would be a claim the public documentation cannot back, and the
metadata API every tenant carries makes the config entry a lookup, not a
guess. MAuth for Rave remains separate deferred work: it is an
authentication scheme for an adapter that already exists, not a source.

## Consequences

- `@dmops/adapters` gains `vault-training` with no new dependencies: the
  Vault API speaks JSON over the same fetch the other adapters use.
- The synthetic `lms-like` posture in the ADR-0019 engine tests retires:
  the split-deployment case now pins against the real adapter's declared
  capabilities, which is what that test was always waiting for. The
  `expires_date: derived` posture keeps the metric available with the
  field reported derived, not native — the availability surface says so.
- No migration, no metric change, no version bump: the mirrors' feeding
  rule (first active source whose capabilities support the frame,
  ADR-0013) picks the adapter up as-is, and `access_training_gap` v2.0
  computes for EDC + Vault deployments exactly as ADR-0019 promised.
- `.env.example` documents the credential indirection
  (`usernameEnv`/`passwordEnv`); config carries `baseUrl` (the tenant's
  Vault DNS), `learnerEmailPath`, `stateMap`, and optionally
  `learnerNamePath` and `studyField`.
- A production tenant's first extraction may fail loudly on an unmapped
  lifecycle state or an email path that resolves nothing; the fix is a
  config entry made with the observed value in hand (ADR-0017, consequence
  accepted there and again here).
- The adapter is written against API v25.1 as consulted; Veeva's developer
  portal is mid-migration to a new host, so claims should be re-verified
  against the successor portal when it stabilizes (the ADR-0017 Rave
  precedent: cite what was actually read, revisit when the vendor moves).
