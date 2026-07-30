# ADR-0002: The stack and license mirror edc-core and ctms-core

**Status**: accepted · 2026-07-30

## Decision

TypeScript end-to-end: pnpm workspaces, Node 22+, Postgres 16 with Drizzle ORM
and hand-written SQL migrations, zod, Hono with zod-openapi, React + Vite +
Tailwind, Astro Starlight docs, Docker Compose deployment. License is
AGPL-3.0, same as the siblings.

## Rationale

dmops-core is the third repo in an ecosystem (edc-core, ctms-core,
clinical-stack) that shares one architecture: compliance enforced below the app
layer, derived-over-stored views, generated validation evidence, and plain
OpenAPI integration between systems. Reusing that architecture means the audit
machinery, validation tooling, and deployment shape arrive proven rather than
reinvented, and an organization installing more than one of these systems
maintains one mental model. AGPL keeps improvements open, including when the
software is offered as a service.

## Consequences

- Postgres host port 5434 in dev, so all three stacks run on one machine.
- Patterns are ported, not imported: no shared code between siblings; the
  integration contract is the documented HTTP API (ADR-0005).
- Contributors familiar with either sibling can navigate this repo.
