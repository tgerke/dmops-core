---
title: Start here
---

dmops-core serves people with different jobs: DM leads running studies, DM
managers governing plans, analysts running UAT, programmers wiring sources
and metrics, and the sponsors and QA folks reading over everyone's
shoulder. Nobody needs every page. Pick the track that matches your role
and read in order; each step says why it comes next.

Every track names a demo persona from the header dropdown. If you
[run the stack](/dmops-core/getting-started/) first, you can do each step
yourself instead of just reading about it.

## DM leads {#dm-leads}

You own study boards day to day. Work as **Maya Okafor**.

1. [Five-minute tour](/dmops-core/tour/): the whole surface in one sitting,
   including the writes that are yours and the one that isn't.
2. [Milestones](/dmops-core/guide/milestones/): the four-date model, slip
   badges, blockers, and why you can move forecasts but not plans.
3. [Deliverables](/dmops-core/guide/deliverables/): status chips and eTMF
   links, and what the approved date actually refers to.
4. [Metrics](/dmops-core/guide/metrics/): reading the strip, the trend, and
   the by-site drill-down, and what "unavailable" is telling you.

## DM managers {#dm-managers}

Everything in the lead track applies; your additions are governance.
Work as **Daniel Reyes**.

1. [Milestones](/dmops-core/guide/milestones/), re-baselining section: the
   append-only record, the required reason, and the `⟲N` counter.
2. [The API](/dmops-core/guide/api/): the rebaseline endpoint and the
   re-baseline history, for governance reporting.
3. [Milestone taxonomy](/dmops-core/reference/milestone-taxonomy/): the
   governed list itself, and how it changes (pull request, review, sync).

## Analysts and programmers {#analysts}

You run UAT, wire source systems, or add metrics. Work as
**Priya Natarajan** for the UAT parts.

1. [UAT](/dmops-core/guide/uat/): cycles, the defect lifecycle, and the
   completion gate you will run into on purpose.
2. [Adapters](/dmops-core/guide/adapters/): frames and the capability
   model, which is the reason a metric says unavailable instead of lying.
3. [Writing an adapter](/dmops-core/guide/writing-an-adapter/): the
   contract's three obligations, with the reference implementations.
4. [Writing a metric](/dmops-core/guide/writing-a-metric/): the YAML
   definition, the version rule, and qualification against fixtures.

## Sponsor and QA oversight {#oversight}

You read boards; you don't write them. Work as **Sylvia Tran** (sponsor) or
**Ruth Adler** (QA).

1. [Personas and access](/dmops-core/personas-and-access/): what the
   curated sponsor view includes and what stays internal, with the
   side-by-side.
2. [Compliance](/dmops-core/compliance/): the scope argument, the
   database-enforced controls, and the honest gaps list.
3. [Architecture and principles](/dmops-core/architecture/): the six design
   principles the tests trace back to.
