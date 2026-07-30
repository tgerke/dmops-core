---
title: Personas and access
description: Assignment-scoped visibility and one curated sponsor view
---

Access in dmops-core is derived from study assignments, not from a global
role picker: a person holds a role (or several) on specific studies, and
every read and write is scoped by those assignments. QA and admin see the
whole portfolio; everyone else sees the studies they are assigned to. There
is one set of facts underneath: role scoping changes which rows and fields
you see, never the numbers themselves (DM-P5).

## What each role can do

| Capability | Who has it |
| --- | --- |
| Read the whole portfolio | `qa`, `admin` |
| Read an assigned study | any active assignment on that study |
| Write milestones (forecast, actual, status, blockers) | `dm_lead`, `dm_manager` on the study; `admin` |
| Write deliverable status | same rule as milestones |
| Write UAT cycles and defects | milestone writers plus `analyst` on the study |
| Re-baseline a plan | `dm_manager` on the study; `admin` (deliberately stricter than milestone writes) |
| Curated sponsor serialization | a person whose only role on the study is `sponsor_user` |

Two asymmetries are deliberate. UAT writes are wider than milestone writes
because analysts run UAT and data entry belongs where the work happens
([ADR-0010](/dmops-core/reference/decisions/0010-uat-cycles-and-defects-not-test-evidence/)).
Re-baselining is narrower because moving the plan is governance, not an
edit: a `dm_lead` moves forecasts, but only a `dm_manager` or admin moves
the plan
([ADR-0009](/dmops-core/reference/decisions/0009-append-only-rebaseline-governance/)).

## The curated sponsor view

A sponsor-only requester gets the same endpoints and the same numbers with
internal working notes excluded: blocker notes, re-baseline reasons, and
defect resolution notes. This is a serialization rule enforced in the API,
so the web board and any other client get it for free.

Here is the same Closeout section of DMOPS-001's board, first as Maya
Okafor (DM lead):

![The Closeout section as the DM lead sees it: SAE reconciliation is Blocked with a rose note explaining the 14 open SAE discrepancies, and every row has an edit control](../../assets/screenshots/milestones-closeout.png)

and as Sylvia Tran (sponsor):

![The same Closeout section as the sponsor sees it: the Blocked status and the +21d forecast slip remain visible, but the blocker note and the edit controls are gone](../../assets/screenshots/sponsor-view.png)

The sponsor still sees that SAE reconciliation is blocked and three weeks
behind. Hiding status from the sponsor is not the goal; what stays internal
is the working narrative.

## Dev tokens and production

In the demo, personas are static bearer tokens mapped to seeded people
(`DMOPS_AUTH_MODE=dev`); the header dropdown just swaps the token.
Production replaces the token source with OIDC against a real identity
provider; the assignment-scoping logic underneath is identical. Dev mode
is a demo convenience, not an access-control posture, and it appears on the
[honest gaps list](/dmops-core/compliance/#honest-gaps-current-phase).
