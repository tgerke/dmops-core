import { getAdapter } from "@dmops/adapters";
import {
  MilestoneError,
  canReadStudy,
  canWriteMilestones,
  hasPortfolioRead,
  isSponsorOnly,
  milestoneBoard,
  updateMilestone,
} from "@dmops/core";
import type { Sql } from "@dmops/db";
import { assertRegistryMatchesSpecs, loadSpecs, metricAvailability } from "@dmops/metrics";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { type Env, authMiddleware, authMode, configureTokens } from "./auth.js";
import {
  BoardRowSchema,
  ErrorSchema,
  HealthSchema,
  MilestoneBoardSchema,
  MilestonePatchSchema,
  SnapshotSchema,
  StudyDetailSchema,
  StudyMetricsSchema,
  StudySummarySchema,
} from "./schemas.js";

const security = [{ bearerAuth: [] }];
const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

export function buildApp(sql: Sql) {
  const mode = authMode();
  if (mode === "dev") configureTokens();
  const app = new OpenAPIHono<Env>();
  app.use("*", cors());

  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description:
      mode === "oidc"
        ? "OIDC access token from the configured identity provider (DMOPS_OIDC_ISSUER)."
        : "Dev tokens: see .env.example (DMOPS_TOKEN_*).",
  });

  // Public: spec + interactive reference.
  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "dmops-core API",
      version: "0.1.0",
      description:
        "DM PMO layer beside the EDC: milestone boards, deliverable status, and " +
        "capability-gated quality metrics with immutable, extract-traceable snapshots. " +
        "The web dashboard consumes exactly this API.",
    },
  });
  app.get("/docs", (c) =>
    c.html(`<!doctype html><html><head><title>dmops-core API</title></head><body>
<script id="api-reference" data-url="/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body></html>`),
  );

  const auth = authMiddleware(sql);
  app.use("/studies", auth);
  app.use("/studies/*", auth);

  // --- health (public: deploy probes) ---------------------------------------

  app.openapi(
    createRoute({
      method: "get",
      path: "/health",
      responses: { 200: json(HealthSchema, "Service health") },
    }),
    async (c) => {
      const [migrations] = await sql`
        SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
      const problems = await sql`SELECT * FROM dmops_verify_audit_chain()`;
      return c.json(
        {
          status: "ok",
          migrations: migrations!.n as number,
          audit_chain_verified: problems.length === 0,
        },
        200,
      );
    },
  );

  // --- studies ---------------------------------------------------------------

  app.openapi(
    createRoute({
      method: "get",
      path: "/studies",
      security,
      responses: {
        200: json(z.array(StudySummarySchema), "Studies visible to the caller (DM-P5 row scoping)"),
      },
    }),
    async (c) => {
      const assignments = c.get("assignments");
      const rows = hasPortfolioRead(assignments)
        ? await sql`SELECT * FROM v_study_summary ORDER BY protocol_number`
        : await sql`
            SELECT * FROM v_study_summary
            WHERE study_id = ANY (${assignments.map((a) => a.studyId)}::uuid[])
            ORDER BY protocol_number`;
      return c.json(rows.map(summarize), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/studies/{studyId}",
      security,
      request: { params: z.object({ studyId: z.string().uuid() }) },
      responses: {
        200: json(StudyDetailSchema, "Study detail with source wiring"),
        403: json(ErrorSchema, "Not assigned to this study"),
        404: json(ErrorSchema, "No such study"),
      },
    }),
    async (c) => {
      const { studyId } = c.req.valid("param");
      const denied = requireRead(c.get("assignments"), studyId);
      if (denied) return c.json(denied, 403);
      const [row] = await sql`SELECT * FROM v_study_summary WHERE study_id = ${studyId}`;
      if (!row) return c.json({ error: "no such study" }, 404);
      const [extra] = await sql`SELECT therapeutic_area FROM study WHERE id = ${studyId}`;
      const [source] = await sql`
        SELECT ss.adapter, ss.source_study_key, se.extracted_at, se.status
        FROM study_source ss
        LEFT JOIN LATERAL (
          SELECT extracted_at, status FROM source_extract
          WHERE study_id = ss.study_id ORDER BY extracted_at DESC LIMIT 1
        ) se ON true
        WHERE ss.study_id = ${studyId} AND ss.active`;
      return c.json(
        {
          ...summarize(row),
          therapeutic_area: (extra?.therapeutic_area ?? null) as string | null,
          source: source
            ? {
                adapter: source.adapter as string,
                source_study_key: source.source_study_key as string,
                last_extract_at: source.extracted_at
                  ? new Date(source.extracted_at as string).toISOString()
                  : null,
                last_extract_status: (source.status ?? null) as string | null,
              }
            : null,
        },
        200,
      );
    },
  );

  // --- milestone board -------------------------------------------------------

  app.openapi(
    createRoute({
      method: "get",
      path: "/studies/{studyId}/milestones",
      security,
      request: { params: z.object({ studyId: z.string().uuid() }) },
      responses: {
        200: json(
          MilestoneBoardSchema,
          "Milestone board (sponsor serialization omits blocker notes, DM-P5)",
        ),
        403: json(ErrorSchema, "Not assigned to this study"),
      },
    }),
    async (c) => {
      const { studyId } = c.req.valid("param");
      const assignments = c.get("assignments");
      const denied = requireRead(assignments, studyId);
      if (denied) return c.json(denied, 403);
      const rows = await milestoneBoard(sql, studyId);
      const sponsorView = isSponsorOnly(assignments, studyId);
      const milestones = rows.map((row) => {
        const { study_id: _studyId, blocker_note, updated_at, ...rest } = row;
        return {
          ...rest,
          ...(sponsorView ? {} : { blocker_note }),
          updated_at: new Date(updated_at).toISOString(),
        };
      });
      return c.json({ study_id: studyId, milestones }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/studies/{studyId}/milestones/{code}",
      security,
      request: {
        params: z.object({ studyId: z.string().uuid(), code: z.string() }),
        query: z.object({ occurrence: z.coerce.number().int().positive().default(1) }),
        body: { content: { "application/json": { schema: MilestonePatchSchema } }, required: true },
      },
      responses: {
        200: json(BoardRowSchema, "Updated milestone (write audited via withActor, ADR-0003)"),
        400: json(ErrorSchema, "Invalid patch"),
        403: json(ErrorSchema, "Milestone writes require DM leadership on the study"),
        404: json(ErrorSchema, "No such milestone on this study"),
      },
    }),
    async (c) => {
      const { studyId, code } = c.req.valid("param");
      const { occurrence } = c.req.valid("query");
      const assignments = c.get("assignments");
      if (!canWriteMilestones(assignments, studyId)) {
        return c.json(
          { error: "milestone writes require a dm_lead, dm_manager, or admin assignment" },
          403,
        );
      }
      try {
        const row = await updateMilestone(sql, c.get("actor"), {
          studyId,
          code,
          occurrence,
          patch: c.req.valid("json"),
        });
        const { study_id: _studyId, updated_at, ...rest } = row;
        return c.json({ ...rest, updated_at: new Date(updated_at).toISOString() }, 200);
      } catch (e) {
        if (e instanceof MilestoneError) {
          return c.json({ error: e.message }, e.code === "not_found" ? 404 : 400);
        }
        throw e;
      }
    },
  );

  // --- metrics ---------------------------------------------------------------

  app.openapi(
    createRoute({
      method: "get",
      path: "/studies/{studyId}/metrics",
      security,
      request: { params: z.object({ studyId: z.string().uuid() }) },
      responses: {
        200: json(
          StudyMetricsSchema,
          "Latest snapshot per metric, with capability-gated availability (ADR-0005)",
        ),
        403: json(ErrorSchema, "Not assigned to this study"),
      },
    }),
    async (c) => {
      const { studyId } = c.req.valid("param");
      const denied = requireRead(c.get("assignments"), studyId);
      if (denied) return c.json(denied, 403);

      const specs = assertRegistryMatchesSpecs(loadSpecs());
      const [source] = await sql`
        SELECT adapter FROM study_source WHERE study_id = ${studyId} AND active`;
      const capabilities = source ? getAdapter(source.adapter as string).capabilities() : null;
      const latest = await sql`
        SELECT * FROM v_metric_latest
        WHERE study_id = ${studyId} AND grain = 'study'`;

      const metrics = specs.map(({ spec }) => {
        const snapshot = latest.find((r) => r.metric_id === spec.id) ?? null;
        let availability: string;
        if (spec.source_frames.length === 0) {
          availability = snapshot ? "computed" : "not yet computed";
        } else if (!capabilities) {
          availability = "unavailable: no active study_source";
        } else {
          const a = metricAvailability(spec, capabilities);
          availability = a.available
            ? snapshot
              ? "computed"
              : "not yet computed"
            : `unavailable: source '${capabilities.adapter}' missing ${a.missing.join(", ")}`;
        }
        return {
          metric_id: spec.id,
          version: spec.version,
          label: spec.label,
          target: spec.target ?? null,
          availability,
          latest: snapshot ? serializeSnapshot(snapshot) : null,
        };
      });
      return c.json({ study_id: studyId, metrics }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/studies/{studyId}/metrics/{metricId}/snapshots",
      security,
      request: {
        params: z.object({ studyId: z.string().uuid(), metricId: z.string() }),
        query: z.object({ grain: z.enum(["study", "site", "country", "portfolio"]).optional() }),
      },
      responses: {
        200: json(z.array(SnapshotSchema), "Snapshot history, newest first (immutable, DM-P3)"),
        403: json(ErrorSchema, "Not assigned to this study"),
      },
    }),
    async (c) => {
      const { studyId, metricId } = c.req.valid("param");
      const { grain } = c.req.valid("query");
      const denied = requireRead(c.get("assignments"), studyId);
      if (denied) return c.json(denied, 403);
      const rows = grain
        ? await sql`
            SELECT * FROM metric_snapshot
            WHERE study_id = ${studyId} AND metric_id = ${metricId} AND grain = ${grain}
            ORDER BY computed_at DESC, period_start DESC`
        : await sql`
            SELECT * FROM metric_snapshot
            WHERE study_id = ${studyId} AND metric_id = ${metricId}
            ORDER BY computed_at DESC, period_start DESC`;
      return c.json(rows.map(serializeSnapshot), 200);
    },
  );

  return app;
}

function requireRead(
  assignments: { studyId: string; role: string }[],
  studyId: string,
): { error: string } | null {
  return canReadStudy(assignments as Parameters<typeof canReadStudy>[0], studyId)
    ? null
    : { error: "not assigned to this study" };
}

function summarize(row: Record<string, unknown>) {
  return {
    study_id: row.study_id as string,
    protocol_number: row.protocol_number as string,
    short_title: row.short_title as string | null,
    phase: row.phase as string | null,
    indication: row.indication as string | null,
    study_status: row.study_status as string,
    sponsor_name: row.sponsor_name as string | null,
    dm_lead_name: row.dm_lead_name as string | null,
    milestone_total: Number(row.milestone_total),
    milestone_complete: Number(row.milestone_complete),
    milestone_blocked: Number(row.milestone_blocked),
    milestone_in_progress: Number(row.milestone_in_progress),
    milestone_na: Number(row.milestone_na),
    pct_complete: row.pct_complete === null ? null : Number(row.pct_complete),
    next_milestone_code: row.next_milestone_code as string | null,
    next_milestone_label: row.next_milestone_label as string | null,
    next_milestone_planned: row.next_milestone_planned as string | null,
  };
}

function serializeSnapshot(row: Record<string, unknown>) {
  return {
    metric_id: row.metric_id as string,
    metric_version: row.metric_version as string,
    grain: row.grain as string,
    site_id: (row.site_id ?? null) as string | null,
    period_start: row.period_start as string,
    period_end: row.period_end as string,
    value: (row.value ?? null) as string | null,
    numerator: (row.numerator ?? null) as string | null,
    denominator: (row.denominator ?? null) as string | null,
    n_records: (row.n_records ?? null) as number | null,
    computed_at: new Date(row.computed_at as string).toISOString(),
  };
}
