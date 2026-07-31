---
title: Five-minute tour
description: The seeded portfolio end to end, switching personas along the way
---

This tour walks the seeded demo from the portfolio down to the audit trail,
doing one real write in each role along the way. You need the stack running
([Getting started](/dmops-core/getting-started/)); everything below refers
to studies by protocol number and people by the persona dropdown, so it
works on any fresh seed.

## 1. Read the portfolio

Open http://localhost:5175 as **Maya Okafor — DM lead** (the default).
DMOPS-001 is enrolling, 27 of 50 milestones complete, one blocked;
DMOPS-002 is barely started. The progress bars and "next up" column are
derived roll-ups; nobody maintains them.

*Full guide: [Getting started](/dmops-core/getting-started/)*

## 2. Read a board top to bottom

Click **DMOPS-001**. The board stacks the metrics strip, the lock-readiness
panel, deliverables, UAT cycles, the training-and-access roster, and six
milestone tables grouped by phase, ending with Analysis & Reporting because
this study runs the stat module
([ADR-0011](/dmops-core/reference/decisions/0011-stat-programming-as-an-opt-in-module/));
DMOPS-002 never enabled it, so its board stops at Closeout. In the roster,
the red **gap** badges are people holding active access with training
missing, overdue, or expired — mirrored from the source systems, never
entered here
([ADR-0013](/dmops-core/reference/decisions/0013-training-and-access-mirrors/)).

![DMOPS-001's full board as the DM lead: the eleven-card metrics strip, the lock-readiness panel, the deliverables table, two UAT cycles expanded to their defect tables, the training-and-access roster with gap badges, and the phase-grouped milestone tables below](../../assets/screenshots/study-board.png)

Scan the Conduct section: completed milestones carry slip badges against
their planned dates, and the in-flight amendment is forecast 11 days late.
Honest slips, visible to everyone who should see them.

*Full guide: [Milestones](/dmops-core/guide/milestones/)*

## 3. Drill into a metric

Click the **Query turnaround time** card. The detail opens with the trend
across reporting periods and the by-site table, where site 002 is slower
than site 001. Every number traces to a versioned definition and a
checksummed extract.

*Full guide: [Metrics](/dmops-core/guide/metrics/)*

## 4. Read the lock-readiness checklist

Expand the **Lock readiness** panel with the ▸ toggle. The eight gates are
the taxonomy's own dependencies of database lock — derived, not entered;
there is no way to edit anything here
([ADR-0014](/dmops-core/reference/decisions/0014-lock-readiness-derived-from-the-taxonomy/)).
DMOPS-001 is honestly at 0% with SAE reconciliation blocked, and the
signals row shows the live work still open — queries, UAT defects, training
gaps — without moving the score.

*Full guide: [Lock readiness](/dmops-core/guide/lock-readiness/)*

## 5. Move a forecast, as Maya

In the Conduct section, hit **edit** on the protocol amendment row and move
its forecast date. That is a `dm_lead` write: forecasts are yours to keep
honest. Notice there is no way to edit the planned date from here. That
door is deliberately missing.

*Full guide: [Milestones](/dmops-core/guide/milestones/)*

## 6. Re-baseline, as Daniel

Switch to **Daniel Reyes — DM manager**. Moving a plan is governance, so it
has its own path: re-baseline the interim lock (`COND.INTERIM`) through the
API, with a reason:

```bash
STUDY=$(curl -s -H "Authorization: Bearer dev-manager-token" \
  http://localhost:8788/studies | \
  python3 -c "import json,sys; print([s['study_id'] for s in json.load(sys.stdin) if s['protocol_number']=='DMOPS-001'][0])")
curl -s -X POST \
  "http://localhost:8788/studies/$STUDY/milestones/COND.INTERIM/rebaseline" \
  -H "Authorization: Bearer dev-manager-token" \
  -H "Content-Type: application/json" \
  -d '{"planned_date": "2026-10-06", "reason": "Amendment 3 shifted the interim analysis cut"}'
```

Reload the board: the planned date moved and a violet `⟲1` counter appeared
next to it. The old date, the new date, and the reason are now an immutable
governance record. Try the same call as Maya (`dev-dmlead-token`) and you
get a 403: leads move forecasts, managers move plans.

*Full guide: [Milestones](/dmops-core/guide/milestones/), [The API](/dmops-core/guide/api/)*

## 7. Log a defect, as Priya

Switch to **Priya Natarajan — Analyst (UAT)**. Expand the in-progress
regression cycle, log a defect, and note the cycle's **complete** button is
disabled: one critical defect is open and one is awaiting retest. The
completion gate is enforced by the API, not by the button.

*Full guide: [UAT](/dmops-core/guide/uat/)*

## 8. Move an analysis forecast, as Omar

Switch to **Omar Haddad — Biostatistician (analysis)**. Scroll to the
Analysis & Reporting section: DMOPS-001 runs the stat module, so the STAT
milestones live on the same board everyone else reads. Edit the forecast
on the in-progress TLF shells milestone; then try the same on any Closeout
row and notice there is no edit control. Analysis entry belongs to the
analysis team, and DM-phase milestones stay a leadership assertion
([ADR-0011](/dmops-core/reference/decisions/0011-stat-programming-as-an-opt-in-module/)).

*Full guide: [Personas and access](/dmops-core/personas-and-access/)*

## 9. See what the sponsor sees, as Sylvia

Switch to **Sylvia Tran — Sponsor (curated view)**. The SAE reconciliation
milestone is still visibly Blocked and three weeks behind, but the rose
blocker note about vendor discrepancies is gone, along with every edit
control and the defect resolution notes. Same facts, curated fields.

*Full guide: [Personas and access](/dmops-core/personas-and-access/)*

## 10. Read the portfolio roll-up, as Ruth

Switch to **Ruth Adler — QA (portfolio, read-only)** and open **Portfolio**
in the header. The lock-readiness header pools the gate counts — 0 of 16
across both studies — with the monthly burn-up beside it, and every metric
card is an exact aggregate of the stored study snapshots
([ADR-0015](/dmops-core/reference/decisions/0015-portfolio-rollup-derived-from-study-snapshots/)).
Notice what refuses to happen: the median cards show per-study values
instead of a pooled number (a median of medians is not a median), and the
cards a source can't feed say "1 of 2 studies reporting" instead of
pretending to cover the portfolio. Switch back to Maya and follow the same
link: a study-scoped seat gets an explanation, not a smaller portfolio.

*Full guide: [The portfolio](/dmops-core/guide/portfolio/)*

## 11. Verify the audit trail

Everything you just did was written to the hash-chained audit trail,
attributed to the persona that did it:

```bash
curl -s http://localhost:8788/health
```

`"audit_chain_verified": true` means the chain replays end to end. The
verification runs inside the database; the API could not fake it if it
wanted to.

*Full guide: [Compliance](/dmops-core/compliance/)*
