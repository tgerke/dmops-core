# ADR-0006: The portal links to regulated records and is structurally incapable of holding a signature

**Status**: accepted · 2026-07-30

## Decision

Signatures, approvals, and controlled documents live in the validated QMS/eTMF
(ctms-core is the reference). dmops-core stores status plus a URI — the
`deliverable` table has no signature columns, no file storage, and no approval
ceremony, and never will. Training and delegation records, when they arrive,
are mirrors of the LMS, not the record.

## Rationale

Holding the e-signature for a spec approval pulls the full weight of 21 CFR
Part 11 signature manifestation, linking, and non-repudiation into this system
and roughly doubles its validation burden. Displaying status with a link
delivers the same transparency at a fraction of the regulatory surface. Making
the table structurally incapable of being the approval record — rather than
policy-incapable — means scope creep requires a schema change and an ADR, not
a quiet feature.

## Consequences

- Validation posture stays in the low/medium tier: qualify the calculations and
  pipeline integrity, audit the operational writes, and point at the validated
  systems for the rest (docs/03-compliance.md).
- `evidence_uri` and `etmf_uri` link out; link rot is the eTMF's addressability
  problem and is surfaced, not papered over.
