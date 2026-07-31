import { getAdapter } from "@dmops/adapters";
import {
  ANALYSIS_DELIVERABLE_TYPES,
  type BoardRow,
  DeliverableError,
  type DeliverableRow,
  type LockGateRow,
  MilestoneError,
  type Portfolio,
  type PortfolioMetric,
  type RebaselineRecord,
  type RosterRow,
  type TrainingStatusRow,
  type UatCycleRow,
  type UatDefectRow,
  UatError,
  accessRoster,
  canReadStudy,
  canRebaseline,
  canWriteAnalysis,
  canWriteDeliverables,
  canWriteMilestones,
  canWriteUat,
  createUatCycle,
  createUatDefect,
  hasPortfolioRead,
  isSponsorOnly,
  kpiPack,
  listDeliverables,
  listUatCycles,
  listUatDefects,
  lockReadiness,
  milestoneBoard,
  portfolioCsv,
  portfolioRollup,
  rebaselineHistory,
  rebaselineMilestone,
  studySnapshotsCsv,
  trainingStatus,
  updateDeliverable,
  updateMilestone,
  updateUatCycle,
  updateUatDefect,
} from "@dmops/core";
import type { Sql } from "@dmops/db";
import { assertRegistryMatchesSpecs, loadSpecs, metricAvailability } from "@dmops/metrics";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { type Env, authMiddleware, authMode, configureTokens } from "./auth.js";
import {
  AccessRosterSchema,
  BoardRowSchema,
  CycleDefectsSchema,
  DeliverablePatchSchema,
  DeliverableSchema,
  ErrorSchema,
  HealthSchema,
  KpiPackSchema,
  LockReadinessSchema,
  MetricSitesSchema,
  MilestoneBoardSchema,
  MilestonePatchSchema,
  PortfolioSchema,
  RebaselinePostSchema,
  RebaselineRecordSchema,
  RebaselineResultSchema,
  SnapshotSchema,
  StudyDeliverablesSchema,
  StudyDetailSchema,
  StudyMetricsSchema,
  StudySummarySchema,
  StudyTrainingSchema,
  StudyUatCyclesSchema,
  UatCyclePatchSchema,
  UatCyclePostSchema,
  UatCycleSchema,
  UatDefectPatchSchema,
  UatDefectPostSchema,
  UatDefectSchema,
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
  app.use("/portfolio", auth);
  app.use("/portfolio.csv", auth);

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
        const { blocker_note, ...rest } = serializeBoardRow(row);
        return { ...rest, ...(sponsorView ? {} : { blocker_note }) };
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
        400: json(
          ErrorSchema,
          "Invalid patch — planned_date and baseline_date are not writable here; " +
            "the plan moves only via POST .../rebaseline (ADR-0008, ADR-0009)",
        ),
        403: json(
          ErrorSchema,
          "Milestone writes require DM leadership on the study; analysis-phase " +
            "milestones also accept programmer or biostat assignments (ADR-0011)",
        ),
        404: json(ErrorSchema, "No such milestone on this study"),
      },
    }),
    async (c) => {
      const { studyId, code } = c.req.valid("param");
      const { occurrence } = c.req.valid("query");
      const assignments = c.get("assignments");
      // Phase-scoped write posture (ADR-0011): analysis-phase milestones
      // belong to the team doing the work (DM-P6); DM phases stay
      // leadership-only.
      const [def] = await sql`
        SELECT phase_group FROM milestone_definition WHERE code = ${code}`;
      const allowed =
        def?.phase_group === "analysis"
          ? canWriteAnalysis(assignments, studyId)
          : canWriteMilestones(assignments, studyId);
      if (!allowed) {
        return c.json(
          {
            error:
              def?.phase_group === "analysis"
                ? "analysis milestone writes require a dm_lead, dm_manager, programmer, biostat, or admin assignment"
                : "milestone writes require a dm_lead, dm_manager, or admin assignment",
          },
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
        return c.json(serializeBoardRow(row), 200);
      } catch (e) {
        if (e instanceof MilestoneError) {
          return c.json({ error: e.message }, e.code === "not_found" ? 404 : 400);
        }
        throw e;
      }
    },
  );

  // --- re-baselining (ADR-0009) ---------------------------------------------

  app.openapi(
    createRoute({
      method: "post",
      path: "/studies/{studyId}/milestones/{code}/rebaseline",
      security,
      request: {
        params: z.object({ studyId: z.string().uuid(), code: z.string() }),
        query: z.object({ occurrence: z.coerce.number().int().positive().default(1) }),
        body: {
          content: { "application/json": { schema: RebaselinePostSchema } },
          required: true,
        },
      },
      responses: {
        201: json(
          RebaselineResultSchema,
          "Re-baseline applied: an immutable governance record appended and " +
            "planned_date moved in the same audited transaction (ADR-0009, ADR-0003). " +
            "baseline_date never moves.",
        ),
        400: json(ErrorSchema, "Milestone is complete/na, or the reason is not substantive"),
        403: json(ErrorSchema, "Re-baselining requires dm_manager on the study, or admin"),
        404: json(ErrorSchema, "No such milestone on this study"),
      },
    }),
    async (c) => {
      const { studyId, code } = c.req.valid("param");
      const { occurrence } = c.req.valid("query");
      if (!canRebaseline(c.get("assignments"), studyId)) {
        return c.json(
          { error: "re-baselining requires a dm_manager assignment on the study, or admin" },
          403,
        );
      }
      const body = c.req.valid("json");
      try {
        const { milestone, rebaseline } = await rebaselineMilestone(sql, c.get("actor"), {
          studyId,
          code,
          occurrence,
          newPlannedDate: body.planned_date,
          reason: body.reason,
          referenceUri: body.reference_uri ?? null,
        });
        return c.json(
          { milestone: serializeBoardRow(milestone), rebaseline: serializeRebaseline(rebaseline) },
          201,
        );
      } catch (e) {
        if (e instanceof MilestoneError) {
          return c.json({ error: e.message }, e.code === "not_found" ? 404 : 400);
        }
        throw e;
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/studies/{studyId}/milestones/{code}/rebaselines",
      security,
      request: {
        params: z.object({ studyId: z.string().uuid(), code: z.string() }),
        query: z.object({ occurrence: z.coerce.number().int().positive().default(1) }),
      },
      responses: {
        200: json(
          z.array(RebaselineRecordSchema),
          "Re-baseline history, ascending (sponsor serialization omits reasons, DM-P5)",
        ),
        403: json(ErrorSchema, "Not assigned to this study"),
        404: json(ErrorSchema, "No such milestone on this study"),
      },
    }),
    async (c) => {
      const { studyId, code } = c.req.valid("param");
      const { occurrence } = c.req.valid("query");
      const assignments = c.get("assignments");
      const denied = requireRead(assignments, studyId);
      if (denied) return c.json(denied, 403);
      const records = await rebaselineHistory(sql, studyId, code, occurrence);
      if (records === null) {
        return c.json({ error: `milestone ${code} (occurrence ${occurrence}) not found` }, 404);
      }
      const sponsorView = isSponsorOnly(assignments, studyId);
      return c.json(
        records.map((r) => {
          const { reason, ...rest } = serializeRebaseline(r);
          return { ...rest, ...(sponsorView ? {} : { reason }) };
        }),
        200,
      );
    },
  );

  // --- deliverables (ADR-0006: status + eTMF pointer, display-only) ---------

  app.openapi(
    createRoute({
      method: "get",
      path: "/studies/{studyId}/deliverables",
      security,
      request: { params: z.object({ studyId: z.string().uuid() }) },
      responses: {
        200: json(
          StudyDeliverablesSchema,
          "Deliverable status with eTMF pointers — display-only, never the record (ADR-0006, DM-P4)",
        ),
        403: json(ErrorSchema, "Not assigned to this study"),
      },
    }),
    async (c) => {
      const { studyId } = c.req.valid("param");
      const denied = requireRead(c.get("assignments"), studyId);
      if (denied) return c.json(denied, 403);
      const rows = await listDeliverables(sql, studyId);
      return c.json({ study_id: studyId, deliverables: rows.map(serializeDeliverable) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/studies/{studyId}/deliverables/{deliverableId}",
      security,
      request: {
        params: z.object({ studyId: z.string().uuid(), deliverableId: z.string().uuid() }),
        body: {
          content: { "application/json": { schema: DeliverablePatchSchema } },
          required: true,
        },
      },
      responses: {
        200: json(
          DeliverableSchema,
          "Updated deliverable (write audited via withActor, ADR-0003; status and pointer only, ADR-0006)",
        ),
        400: json(ErrorSchema, "Invalid patch, or approved without an approved_date"),
        403: json(
          ErrorSchema,
          "Deliverable writes require DM leadership on the study; analysis " +
            "deliverable types also accept programmer or biostat assignments (ADR-0011)",
        ),
        404: json(ErrorSchema, "No such deliverable on this study"),
      },
    }),
    async (c) => {
      const { studyId, deliverableId } = c.req.valid("param");
      // Analysis deliverable types take the phase-scoped predicate
      // (ADR-0011); a missing row falls through to the DM predicate and then
      // 404s for writers, so non-writers cannot probe existence.
      const [existing] = await sql`
        SELECT type FROM deliverable WHERE id = ${deliverableId} AND study_id = ${studyId}`;
      const isAnalysisType = existing
        ? ANALYSIS_DELIVERABLE_TYPES.has(existing.type as string)
        : false;
      const allowed = isAnalysisType
        ? canWriteAnalysis(c.get("assignments"), studyId)
        : canWriteDeliverables(c.get("assignments"), studyId);
      if (!allowed) {
        return c.json(
          {
            error: isAnalysisType
              ? "analysis deliverable writes require a dm_lead, dm_manager, programmer, biostat, or admin assignment"
              : "deliverable writes require a dm_lead, dm_manager, or admin assignment",
          },
          403,
        );
      }
      try {
        const row = await updateDeliverable(sql, c.get("actor"), {
          studyId,
          deliverableId,
          patch: c.req.valid("json"),
        });
        return c.json(serializeDeliverable(row), 200);
      } catch (e) {
        if (e instanceof DeliverableError) {
          return c.json({ error: e.message }, e.code === "not_found" ? 404 : 400);
        }
        throw e;
      }
    },
  );

  // --- UAT cycles and defects (ADR-0010) -------------------------------------

  const uatWriteDenied = {
    error: "UAT writes require a dm_lead, dm_manager, analyst, or admin assignment",
  };

  app.openapi(
    createRoute({
      method: "get",
      path: "/studies/{studyId}/uat-cycles",
      security,
      request: { params: z.object({ studyId: z.string().uuid() }) },
      responses: {
        200: json(
          StudyUatCyclesSchema,
          "Cycle status with derived defect counts and an evidence pointer — script " +
            "execution stays in the validated system and the eTMF (ADR-0010, DM-P4)",
        ),
        403: json(ErrorSchema, "Not assigned to this study"),
      },
    }),
    async (c) => {
      const { studyId } = c.req.valid("param");
      const denied = requireRead(c.get("assignments"), studyId);
      if (denied) return c.json(denied, 403);
      const rows = await listUatCycles(sql, studyId);
      return c.json({ study_id: studyId, cycles: rows.map(serializeUatCycle) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/studies/{studyId}/uat-cycles",
      security,
      request: {
        params: z.object({ studyId: z.string().uuid() }),
        body: { content: { "application/json": { schema: UatCyclePostSchema } }, required: true },
      },
      responses: {
        201: json(
          UatCycleSchema,
          "New UAT cycle (write audited via withActor, ADR-0003); cycle_number is assigned serially",
        ),
        400: json(ErrorSchema, "Invalid cycle"),
        403: json(ErrorSchema, "UAT writes require DM leadership or an analyst assignment"),
        404: json(ErrorSchema, "No such study"),
      },
    }),
    async (c) => {
      const { studyId } = c.req.valid("param");
      if (!canWriteUat(c.get("assignments"), studyId)) {
        return c.json(uatWriteDenied, 403);
      }
      const body = c.req.valid("json");
      try {
        const row = await createUatCycle(sql, c.get("actor"), {
          studyId,
          title: body.title,
          startedDate: body.started_date ?? null,
          scriptsPlanned: body.scripts_planned ?? null,
        });
        return c.json(serializeUatCycle(row), 201);
      } catch (e) {
        if (e instanceof UatError) {
          return c.json({ error: e.message }, e.code === "not_found" ? 404 : 400);
        }
        throw e;
      }
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/studies/{studyId}/uat-cycles/{cycleId}",
      security,
      request: {
        params: z.object({ studyId: z.string().uuid(), cycleId: z.string().uuid() }),
        body: { content: { "application/json": { schema: UatCyclePatchSchema } }, required: true },
      },
      responses: {
        200: json(
          UatCycleSchema,
          "Updated cycle (audited, ADR-0003). Completion is refused while defects are " +
            "open or awaiting retest — UAT.COMPLETE means defects resolved (ADR-0010)",
        ),
        400: json(
          ErrorSchema,
          "Invalid patch, an undated ending, or completion with unresolved defects",
        ),
        403: json(ErrorSchema, "UAT writes require DM leadership or an analyst assignment"),
        404: json(ErrorSchema, "No such cycle on this study"),
      },
    }),
    async (c) => {
      const { studyId, cycleId } = c.req.valid("param");
      if (!canWriteUat(c.get("assignments"), studyId)) {
        return c.json(uatWriteDenied, 403);
      }
      try {
        const row = await updateUatCycle(sql, c.get("actor"), {
          studyId,
          cycleId,
          patch: c.req.valid("json"),
        });
        return c.json(serializeUatCycle(row), 200);
      } catch (e) {
        if (e instanceof UatError) {
          return c.json({ error: e.message }, e.code === "not_found" ? 404 : 400);
        }
        throw e;
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/studies/{studyId}/uat-cycles/{cycleId}/defects",
      security,
      request: {
        params: z.object({ studyId: z.string().uuid(), cycleId: z.string().uuid() }),
      },
      responses: {
        200: json(
          CycleDefectsSchema,
          "Defect log for a cycle. The sponsor serialization omits resolution notes (DM-P5)",
        ),
        403: json(ErrorSchema, "Not assigned to this study"),
        404: json(ErrorSchema, "No such cycle on this study"),
      },
    }),
    async (c) => {
      const { studyId, cycleId } = c.req.valid("param");
      const denied = requireRead(c.get("assignments"), studyId);
      if (denied) return c.json(denied, 403);
      const rows = await listUatDefects(sql, studyId, cycleId);
      if (rows === null) return c.json({ error: "UAT cycle not found on this study" }, 404);
      const sponsorView = isSponsorOnly(c.get("assignments"), studyId);
      const defects = rows.map((row) => {
        const { resolution_note, ...rest } = serializeUatDefect(row);
        return { ...rest, ...(sponsorView ? {} : { resolution_note }) };
      });
      return c.json({ study_id: studyId, cycle_id: cycleId, defects }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/studies/{studyId}/uat-cycles/{cycleId}/defects",
      security,
      request: {
        params: z.object({ studyId: z.string().uuid(), cycleId: z.string().uuid() }),
        body: { content: { "application/json": { schema: UatDefectPostSchema } }, required: true },
      },
      responses: {
        201: json(
          UatDefectSchema,
          "New defect (write audited via withActor, ADR-0003); defect_number is assigned serially",
        ),
        400: json(ErrorSchema, "Invalid defect, or the cycle is complete or cancelled"),
        403: json(ErrorSchema, "UAT writes require DM leadership or an analyst assignment"),
        404: json(ErrorSchema, "No such cycle on this study"),
      },
    }),
    async (c) => {
      const { studyId, cycleId } = c.req.valid("param");
      if (!canWriteUat(c.get("assignments"), studyId)) {
        return c.json(uatWriteDenied, 403);
      }
      const body = c.req.valid("json");
      try {
        const row = await createUatDefect(sql, c.get("actor"), {
          studyId,
          cycleId,
          title: body.title,
          severity: body.severity,
          raisedDate: body.raised_date ?? null,
          referenceUri: body.reference_uri ?? null,
        });
        return c.json(serializeUatDefect(row), 201);
      } catch (e) {
        if (e instanceof UatError) {
          return c.json({ error: e.message }, e.code === "not_found" ? 404 : 400);
        }
        throw e;
      }
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/studies/{studyId}/uat-cycles/{cycleId}/defects/{defectId}",
      security,
      request: {
        params: z.object({
          studyId: z.string().uuid(),
          cycleId: z.string().uuid(),
          defectId: z.string().uuid(),
        }),
        body: { content: { "application/json": { schema: UatDefectPatchSchema } }, required: true },
      },
      responses: {
        200: json(
          UatDefectSchema,
          "Updated defect (audited, ADR-0003). Endings are dated facts: resolution " +
            "requires a date, closure a substantive note (ADR-0010)",
        ),
        400: json(ErrorSchema, "Invalid patch, an undated resolution, or an unexplained closure"),
        403: json(ErrorSchema, "UAT writes require DM leadership or an analyst assignment"),
        404: json(ErrorSchema, "No such defect on this cycle"),
      },
    }),
    async (c) => {
      const { studyId, cycleId, defectId } = c.req.valid("param");
      if (!canWriteUat(c.get("assignments"), studyId)) {
        return c.json(uatWriteDenied, 403);
      }
      try {
        const row = await updateUatDefect(sql, c.get("actor"), {
          studyId,
          cycleId,
          defectId,
          patch: c.req.valid("json"),
        });
        return c.json(serializeUatDefect(row), 200);
      } catch (e) {
        if (e instanceof UatError) {
          return c.json({ error: e.message }, e.code === "not_found" ? 404 : 400);
        }
        throw e;
      }
    },
  );

  // --- training and access mirrors (ADR-0013) --------------------------------

  app.openapi(
    createRoute({
      method: "get",
      path: "/studies/{studyId}/access-roster",
      security,
      request: { params: z.object({ studyId: z.string().uuid() }) },
      responses: {
        200: json(
          AccessRosterSchema,
          "Access roster mirrored from the source system, joined with training " +
            "status (ADR-0013). Display-only with extract provenance — the record " +
            "lives in the source (ADR-0006, DM-P4); training_gap flags active " +
            "access whose training is missing, overdue, or expired. Empty until " +
            "a source that supports access_grants is wired.",
        ),
        403: json(ErrorSchema, "Not assigned to this study"),
      },
    }),
    async (c) => {
      const { studyId } = c.req.valid("param");
      const denied = requireRead(c.get("assignments"), studyId);
      if (denied) return c.json(denied, 403);
      const rows = await accessRoster(sql, studyId);
      return c.json({ study_id: studyId, people: rows.map(serializeRosterRow) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/studies/{studyId}/training",
      security,
      request: { params: z.object({ studyId: z.string().uuid() }) },
      responses: {
        200: json(
          StudyTrainingSchema,
          "Training records mirrored from the LMS, with status derived from the " +
            "dated facts at read time (ADR-0013). Display-only — the LMS holds " +
            "the record (ADR-0006, DM-P4). Empty until a source that supports " +
            "training_records is wired.",
        ),
        403: json(ErrorSchema, "Not assigned to this study"),
      },
    }),
    async (c) => {
      const { studyId } = c.req.valid("param");
      const denied = requireRead(c.get("assignments"), studyId);
      if (denied) return c.json(denied, 403);
      const rows = await trainingStatus(sql, studyId);
      return c.json({ study_id: studyId, records: rows.map(serializeTrainingRow) }, 200);
    },
  );

  // --- lock-readiness (ADR-0014) ---------------------------------------------

  app.openapi(
    createRoute({
      method: "get",
      path: "/studies/{studyId}/lock-readiness",
      security,
      request: { params: z.object({ studyId: z.string().uuid() }) },
      responses: {
        200: json(
          LockReadinessSchema,
          "Derived lock-readiness: the depends_on closure of CLOSE.LOCK in the " +
            "governed taxonomy as a per-gate checklist with an unweighted score, " +
            "plus live signals (open queries as of the latest snapshot, UAT state, " +
            "training gaps) that never move the score (ADR-0014). Nothing here is " +
            "writable — the score moves only when the milestones move. Sponsor " +
            "serialization omits gate blocker notes (DM-P5).",
        ),
        403: json(ErrorSchema, "Not assigned to this study"),
        404: json(ErrorSchema, "No such study"),
      },
    }),
    async (c) => {
      const { studyId } = c.req.valid("param");
      const assignments = c.get("assignments");
      const denied = requireRead(assignments, studyId);
      if (denied) return c.json(denied, 403);
      const result = await lockReadiness(sql, studyId);
      if (!result) return c.json({ error: "no such study" }, 404);
      const sponsorView = isSponsorOnly(assignments, studyId);
      const gates = result.gates.map((row) => {
        const { blocker_note, ...rest } = serializeLockGate(row);
        return { ...rest, ...(sponsorView ? {} : { blocker_note }) };
      });
      const s = result.summary;
      return c.json(
        {
          study_id: studyId,
          gates_applicable: Number(s.gates_applicable),
          gates_satisfied: Number(s.gates_satisfied),
          gates_blocked: Number(s.gates_blocked),
          readiness_pct: s.readiness_pct === null ? null : Number(s.readiness_pct),
          next_gate_code: s.next_gate_code,
          next_gate_label: s.next_gate_label,
          lock_planned_date: s.lock_planned_date,
          lock_forecast_date: s.lock_forecast_date,
          lock_actual_date: s.lock_actual_date,
          open_queries: s.open_queries === null ? null : Number(s.open_queries),
          open_queries_as_of: s.open_queries_as_of,
          uat_open_cycles: s.uat_open_cycles === null ? null : Number(s.uat_open_cycles),
          uat_unresolved_defects:
            s.uat_unresolved_defects === null ? null : Number(s.uat_unresolved_defects),
          training_gaps: s.training_gaps === null ? null : Number(s.training_gaps),
          gates,
          evidence_conflicts: result.conflicts,
        },
        200,
      );
    },
  );

  // --- portfolio roll-up (ADR-0015) -------------------------------------------

  app.openapi(
    createRoute({
      method: "get",
      path: "/portfolio",
      security,
      responses: {
        200: json(
          PortfolioSchema,
          "Portfolio roll-up derived from stored study snapshots (ADR-0015): " +
            "ratio and count metrics pooled exactly from numerators and " +
            "denominators (ADR-0007), medians served as a named absence with " +
            "the per-study spread — never a pooled median — and the " +
            "lock-readiness burn-up from the monthly DM-Q9 snapshots " +
            "(ADR-0014). One fact at portfolio grain: requires portfolio read " +
            "(qa or admin), because a value pooled over whichever studies the " +
            "caller holds would be a different portfolio number per audience " +
            "(DM-P5).",
        ),
        403: json(ErrorSchema, "Portfolio read requires a qa or admin assignment"),
      },
    }),
    async (c) => {
      if (!hasPortfolioRead(c.get("assignments"))) {
        return c.json({ error: "portfolio read requires a qa or admin assignment" }, 403);
      }
      const portfolio = await portfolioRollup(sql);
      return c.json(serializePortfolio(portfolio), 200);
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

      // The module boundary hides other modules' metrics entirely — no
      // permanent "unavailable" rows for a module the study never enabled
      // (ADR-0011).
      const [studyRow] = await sql`SELECT modules FROM study WHERE id = ${studyId}`;
      const modules = (studyRow?.modules ?? ["dm"]) as string[];
      const specs = assertRegistryMatchesSpecs(loadSpecs()).filter(({ spec }) =>
        modules.includes(spec.module),
      );
      const [source] = await sql`
        SELECT adapter, config FROM study_source WHERE study_id = ${studyId} AND active`;
      // Posture can depend on the study's source config (ADR-0018).
      const capabilities = source
        ? getAdapter(source.adapter as string).capabilities(
            source.config as Record<string, unknown>,
          )
        : null;
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
      path: "/studies/{studyId}/metrics/{metricId}/sites",
      security,
      request: {
        params: z.object({ studyId: z.string().uuid(), metricId: z.string() }),
      },
      responses: {
        200: json(
          MetricSitesSchema,
          "Latest site-grain snapshot per site — the same versioned metric at site grain (DM-P2). " +
            "Empty for metrics that emit study grain only.",
        ),
        403: json(ErrorSchema, "Not assigned to this study"),
      },
    }),
    async (c) => {
      const { studyId, metricId } = c.req.valid("param");
      const denied = requireRead(c.get("assignments"), studyId);
      if (denied) return c.json(denied, 403);
      const rows = await sql`
        SELECT v.*, s.site_number, s.name AS site_name, s.country
        FROM v_metric_latest v
        JOIN site s ON s.id = v.site_id
        WHERE v.study_id = ${studyId} AND v.metric_id = ${metricId} AND v.grain = 'site'
        ORDER BY s.site_number`;
      return c.json(
        {
          study_id: studyId,
          metric_id: metricId,
          sites: rows.map((r) => ({
            ...serializeSnapshot(r),
            site_number: r.site_number as string,
            site_name: (r.site_name ?? null) as string | null,
            country: (r.country ?? null) as string | null,
          })),
        },
        200,
      );
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

  // --- exports and KPI packs (ADR-0016) --------------------------------------

  const csv = (description: string) => ({
    content: { "text/csv": { schema: z.string() } },
    description,
  });

  app.openapi(
    createRoute({
      method: "get",
      path: "/studies/{studyId}/snapshots.csv",
      security,
      request: { params: z.object({ studyId: z.string().uuid() }) },
      responses: {
        200: csv(
          "The study's full snapshot history as one flat file (DM-P3 re-served " +
            "as text/csv, ADR-0016), with the cited extract's adapter and " +
            "checksum joined on. The same rows, the same authorization.",
        ),
        403: json(ErrorSchema, "Not assigned to this study"),
      },
    }),
    async (c) => {
      const { studyId } = c.req.valid("param");
      const denied = requireRead(c.get("assignments"), studyId);
      if (denied) return c.json(denied, 403);
      const [study] = await sql`SELECT protocol_number FROM study WHERE id = ${studyId}`;
      const body = await studySnapshotsCsv(sql, studyId);
      return c.text(body, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${study?.protocol_number ?? studyId}-snapshots.csv"`,
      });
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/portfolio.csv",
      security,
      responses: {
        200: csv(
          "The portfolio roll-up flattened (ADR-0015 re-served as text/csv, " +
            "ADR-0016): one rollup row per metric, then per-study spread rows " +
            "where pooling declined. Empty pooled cells stay empty.",
        ),
        403: json(ErrorSchema, "Portfolio read requires a qa or admin assignment"),
      },
    }),
    async (c) => {
      if (!hasPortfolioRead(c.get("assignments"))) {
        return c.json({ error: "portfolio read requires a qa or admin assignment" }, 403);
      }
      const body = await portfolioCsv(sql);
      return c.text(body, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="portfolio.csv"',
      });
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/studies/{studyId}/kpi-pack",
      security,
      request: {
        params: z.object({ studyId: z.string().uuid() }),
        query: z.object({
          period: z
            .string()
            .regex(/^\d{4}-\d{2}$/)
            .optional(),
        }),
      },
      responses: {
        200: json(
          KpiPackSchema,
          "One reporting period's snapshots for one study (ADR-0016): each " +
            "metric with its registered definition at the computed version " +
            "(ADR-0004), absences named (ADR-0005), and the cited source " +
            "extracts attached — provenance that travels with the artifact. " +
            "Assembled from stored facts; nothing is computed or stored.",
        ),
        403: json(ErrorSchema, "Not assigned to this study"),
        404: json(ErrorSchema, "No snapshots for this study or period"),
      },
    }),
    async (c) => {
      const { studyId } = c.req.valid("param");
      const { period } = c.req.valid("query");
      const denied = requireRead(c.get("assignments"), studyId);
      if (denied) return c.json(denied, 403);
      const pack = await kpiPack(sql, studyId, {
        period,
        generatedBy: c.get("actor").label,
      });
      if (!pack) {
        return c.json({ error: "no snapshots for this study or period" }, 404);
      }
      return c.json(pack, 200);
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

function serializeDeliverable(row: DeliverableRow) {
  const { study_id: _studyId, updated_at, ...rest } = row;
  return { ...rest, updated_at: new Date(updated_at).toISOString() };
}

function serializeUatCycle(row: UatCycleRow) {
  const { study_id: _studyId, updated_at, ...rest } = row;
  return {
    ...rest,
    cycle_number: Number(row.cycle_number),
    scripts_planned: row.scripts_planned === null ? null : Number(row.scripts_planned),
    scripts_executed: row.scripts_executed === null ? null : Number(row.scripts_executed),
    open_defects: Number(row.open_defects),
    resolved_defects: Number(row.resolved_defects),
    closed_defects: Number(row.closed_defects),
    withdrawn_defects: Number(row.withdrawn_defects),
    total_defects: Number(row.total_defects),
    updated_at: new Date(updated_at).toISOString(),
  };
}

function serializeUatDefect(row: UatDefectRow) {
  const { cycle_id: _cycleId, updated_at, ...rest } = row;
  return {
    ...rest,
    defect_number: Number(row.defect_number),
    updated_at: new Date(updated_at).toISOString(),
  };
}

function serializeBoardRow(row: BoardRow) {
  const { study_id: _studyId, updated_at, last_rebaselined_at, rebaseline_count, ...rest } = row;
  return {
    ...rest,
    rebaseline_count: Number(rebaseline_count),
    last_rebaselined_at: last_rebaselined_at ? new Date(last_rebaselined_at).toISOString() : null,
    updated_at: new Date(updated_at).toISOString(),
  };
}

function serializeRebaseline(r: RebaselineRecord) {
  return {
    rebaseline_number: Number(r.rebaseline_number),
    previous_planned_date: r.previous_planned_date,
    new_planned_date: r.new_planned_date,
    reason: r.reason,
    reference_uri: r.reference_uri,
    created_at: new Date(r.created_at).toISOString(),
  };
}

function serializeLockGate(row: LockGateRow) {
  const { study_id: _studyId, ...rest } = row;
  return {
    ...rest,
    sequence: Number(row.sequence),
    occurrence: row.occurrence === null ? null : Number(row.occurrence),
  };
}

function serializeRosterRow(row: RosterRow) {
  const { study_id: _studyId, ...rest } = row;
  return {
    ...rest,
    trainings_on_file: Number(row.trainings_on_file),
    trainings_current: Number(row.trainings_current),
    trainings_overdue: Number(row.trainings_overdue),
    trainings_expired: Number(row.trainings_expired),
    trainings_pending: Number(row.trainings_pending),
    first_granted_at: row.first_granted_at ? new Date(row.first_granted_at).toISOString() : null,
    mirrored_at: new Date(row.mirrored_at).toISOString(),
  };
}

function serializeTrainingRow(row: TrainingStatusRow) {
  const { study_id: _studyId, ...rest } = row;
  return { ...rest, mirrored_at: new Date(row.mirrored_at).toISOString() };
}

function serializePortfolioMetric(m: PortfolioMetric) {
  return {
    ...m,
    studies_in_scope: Number(m.studies_in_scope),
    studies_reporting: Number(m.studies_reporting),
    pooled:
      m.pooled === null
        ? null
        : {
            numerator: Number(m.pooled.numerator),
            denominator: Number(m.pooled.denominator),
            pct: m.pooled.pct === null ? null : Number(m.pooled.pct),
          },
    per_study: m.per_study.map((r) => ({
      ...r,
      n_records: r.n_records === null ? null : Number(r.n_records),
    })),
  };
}

function serializePortfolio(p: Portfolio) {
  return {
    studies: p.studies,
    metrics: p.metrics.map(serializePortfolioMetric),
    lock: {
      studies: Number(p.lock.studies),
      gates_applicable: Number(p.lock.gates_applicable),
      gates_satisfied: Number(p.lock.gates_satisfied),
      readiness_pct: p.lock.readiness_pct === null ? null : Number(p.lock.readiness_pct),
      studies_with_blocked_gates: Number(p.lock.studies_with_blocked_gates),
      studies_locked: Number(p.lock.studies_locked),
      per_study: p.lock.per_study.map((r) => ({
        ...r,
        readiness_pct: r.readiness_pct === null ? null : Number(r.readiness_pct),
        gates_satisfied: Number(r.gates_satisfied),
        gates_applicable: Number(r.gates_applicable),
        gates_blocked: Number(r.gates_blocked),
      })),
      trend: p.lock.trend.map((t) => ({
        ...t,
        studies_reporting: Number(t.studies_reporting),
        gates_satisfied: Number(t.gates_satisfied),
        gates_applicable: Number(t.gates_applicable),
        readiness_pct: t.readiness_pct === null ? null : Number(t.readiness_pct),
      })),
    },
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
