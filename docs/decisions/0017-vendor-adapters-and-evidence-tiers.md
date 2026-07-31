# ADR-0017: Vendor adapters ship on tiered public evidence, and an honest zero is shippable

**Status**: accepted · 2026-07-31

## Decision

The Medrio and Medidata Rave adapters are written strictly from evidence a
reader can retrieve, and every capability claim in an adapter header carries
an evidence tier alongside its URL, version, and access date:

- **[P]** — a primary vendor artifact (a machine-readable spec or a
  vendor-hosted page actually read on the cited date).
- **[V-OSS]** — vendor-authored open-source documentation or source code,
  used when the vendor's specification is not publicly reachable.
- **[NC]** — not confirmable from public documentation. An [NC] behavior is
  either left unimplemented or implemented to fail loudly, never guessed.

Two consequences of the rule are accepted deliberately:

1. **A vocabulary the vendor does not publish is discovered at runtime, not
   hardcoded.** Where an enumeration is [NC] (Rave's query status values,
   Medrio's study-configured subject statuses), the adapter maps observed
   values through explicit configuration or a conservative canonicalization,
   and an unrecognized value fails the extraction with the observed value in
   the message — an operator-actionable error, not a silent bucket.
2. **An adapter whose honest capabilities light zero metrics still ships.**
   Medrio's public API (`Medrio OpenApi v.42.14.0.201`, fetched 2026-07-31)
   exposes no query surface, no visit dates, and no entry timestamps, so a
   Medrio-only study computes none of the EDC metric set and the API reports
   each metric unavailable with the named gap. That output is the product
   working (ADR-0005, DM-P1), not a defect: the portal states exactly what
   the source can support and creates the right pressure on it.

## Rationale

The citation bar (CLAUDE.md, ADR-0005) was set assuming vendor documentation
would be reachable. Researching this slice (2026-07-31) showed it often is
not: Medrio's prose documentation sits behind a customer login and only its
OpenAPI document is public, and Medidata's public RWS WebHelp now returns
HTTP 403, leaving Medidata's own open-source client `rwslib` (docs and
source) as the strongest public evidence. Refusing to ship until vendors
publish specifications would mean never shipping; shipping on memory or
plausibility would put unverifiable claims in a compliance-positioned
product. Tiered evidence is the middle path: the reader of an adapter header
can see not just what was claimed but how strong the claim is, and [NC]
marks the exact places where a customer with vendor support access should
verify before production use.

## Consequences

- Adapter headers become provenance records: claim → tier → URL + version +
  access date. A capability claim without a citation does not merge
  (docs/adapters/writing-an-adapter.md).
- `derived`-with-note and `unsupported` do the same honest work they always
  did (ADR-0005); [NC] adds "the vendor may support this, but we cannot
  prove it publicly" as a first-class, documented state.
- Runtime vocabulary discovery means a production deployment's first extract
  against a real tenant may fail loudly on an unmapped value; the fix is a
  config entry, made with the observed value in hand — by design.
- The Rave adapter depends on vendor-authored open-source artifacts
  ([V-OSS]) rather than the RWS specification; if Medidata republishes
  authoritative documentation, claims should be re-verified and re-cited.
- `@dmops/adapters` gains its first real dependency beyond zod
  (`fast-xml-parser`, for ODM XML). A generic parser is not a vendor SDK;
  hand-rolled XML parsing was rejected as a correctness risk.
