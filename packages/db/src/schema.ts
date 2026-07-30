import {
  bigserial,
  boolean,
  char,
  date,
  foreignKey,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const studyStatus = pgEnum("study_status", [
  "planning",
  "startup",
  "enrolling",
  "followup",
  "closeout",
  "locked",
  "archived",
]);

// Role × study assignment is the entitlement model (docs/01-vision.md DM-P5).
export const assignmentRole = pgEnum("assignment_role", [
  "dm_lead",
  "dm_manager",
  "analyst",
  "programmer",
  "clinops",
  "biostat",
  "sponsor_user",
  "qa",
  "admin",
]);

export const milestoneStatus = pgEnum("milestone_status", [
  "not_started",
  "in_progress",
  "complete",
  "blocked",
  "na",
]);

export const phaseGroup = pgEnum("phase_group", [
  "startup_spec",
  "startup_build",
  "startup_release",
  "conduct",
  "closeout",
]);

export const deliverableStatus = pgEnum("deliverable_status", [
  "draft",
  "in_review",
  "approved",
  "superseded",
]);

export const uatCycleStatus = pgEnum("uat_cycle_status", [
  "planned",
  "in_progress",
  "complete",
  "cancelled",
]);

// resolved = fix applied, awaiting retest; closed = verified; withdrawn = not
// a defect or a duplicate (ADR-0010).
export const uatDefectStatus = pgEnum("uat_defect_status", [
  "open",
  "resolved",
  "closed",
  "withdrawn",
]);

export const uatDefectSeverity = pgEnum("uat_defect_severity", ["critical", "major", "minor"]);

export const extractStatus = pgEnum("extract_status", ["ok", "error"]);

export const metricGrain = pgEnum("metric_grain", ["study", "site", "country", "portfolio"]);

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const sponsor = pgTable("sponsor", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const person = pgTable("person", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  org: text("org"),
  active: boolean("active").notNull().default(true),
});

export const study = pgTable("study", {
  id: uuid("id").primaryKey().defaultRandom(),
  protocolNumber: text("protocol_number").notNull().unique(),
  shortTitle: text("short_title"),
  sponsorId: uuid("sponsor_id").references(() => sponsor.id),
  phase: text("phase"),
  indication: text("indication"),
  therapeuticArea: text("therapeutic_area"),
  status: studyStatus("status").notNull().default("planning"),
  dmLeadId: uuid("dm_lead_id").references(() => person.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const site = pgTable(
  "site",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => study.id),
    siteNumber: text("site_number").notNull(),
    name: text("name"),
    country: text("country"),
    piName: text("pi_name"),
    activationDate: date("activation_date"),
  },
  (t) => [uniqueIndex("site_study_number_idx").on(t.studyId, t.siteNumber)],
);

export const studyAssignment = pgTable(
  "study_assignment",
  {
    studyId: uuid("study_id")
      .notNull()
      .references(() => study.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    role: assignmentRole("role").notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
  },
  (t) => [primaryKey({ columns: [t.studyId, t.personId, t.role] })],
);

// ---------------------------------------------------------------------------
// Milestones (ADR-0008: governed taxonomy, instantiated per study)
// ---------------------------------------------------------------------------

export const milestoneDefinition = pgTable("milestone_definition", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  phaseGroup: phaseGroup("phase_group").notNull(),
  sequence: integer("sequence").notNull(),
  defaultOwnerRole: assignmentRole("default_owner_role").notNull().default("dm_lead"),
  dependsOn: text("depends_on").array().notNull().default([]),
  isRepeating: boolean("is_repeating").notNull().default(false),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const studyMilestone = pgTable(
  "study_milestone",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => study.id),
    code: text("code")
      .notNull()
      .references(() => milestoneDefinition.code),
    occurrence: integer("occurrence").notNull().default(1),
    // The planned/forecast/actual triple is what makes slip analysis possible;
    // baseline persists across re-baselining (ADR-0008). Never collapse these.
    baselineDate: date("baseline_date"),
    plannedDate: date("planned_date"),
    forecastDate: date("forecast_date"),
    actualDate: date("actual_date"),
    status: milestoneStatus("status").notNull().default("not_started"),
    ownerId: uuid("owner_id").references(() => person.id),
    blockerNote: text("blocker_note"),
    evidenceUri: text("evidence_uri"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("study_milestone_occurrence_idx").on(t.studyId, t.code, t.occurrence)],
);

// Append-only re-baseline record (ADR-0009): the governance history of every
// planned-date change; study_milestone.planned_date is the projection.
// Hand-written SQL in migrations/0003 is the source of truth.
export const milestoneRebaseline = pgTable(
  "milestone_rebaseline",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyMilestoneId: uuid("study_milestone_id")
      .notNull()
      .references(() => studyMilestone.id),
    rebaselineNumber: integer("rebaseline_number").notNull(),
    previousPlannedDate: date("previous_planned_date"),
    newPlannedDate: date("new_planned_date").notNull(),
    reason: text("reason").notNull(),
    referenceUri: text("reference_uri"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("milestone_rebaseline_seq_idx").on(t.studyMilestoneId, t.rebaselineNumber)],
);

// Status + eTMF pointer only. Structurally incapable of being the approval
// record: no signature columns, ever (ADR-0006).
export const deliverable = pgTable("deliverable", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: uuid("study_id")
    .notNull()
    .references(() => study.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  version: text("version"),
  status: deliverableStatus("status").notNull().default("draft"),
  approvedDate: date("approved_date"),
  etmfUri: text("etmf_uri"),
  ownerId: uuid("owner_id").references(() => person.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// UAT cycles and defects (ADR-0010): operational status, not test evidence.
// Script execution stays in the validated system; counts + evidence_uri only
// (ADR-0006). Hand-written SQL in migrations/0004 is the source of truth.
// ---------------------------------------------------------------------------

export const uatCycle = pgTable(
  "uat_cycle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => study.id),
    cycleNumber: integer("cycle_number").notNull(),
    title: text("title").notNull(),
    status: uatCycleStatus("status").notNull().default("planned"),
    startedDate: date("started_date"),
    completedDate: date("completed_date"),
    scriptsPlanned: integer("scripts_planned"),
    scriptsExecuted: integer("scripts_executed"),
    evidenceUri: text("evidence_uri"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uat_cycle_seq_idx").on(t.studyId, t.cycleNumber)],
);

export const uatDefect = pgTable(
  "uat_defect",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => uatCycle.id),
    defectNumber: integer("defect_number").notNull(),
    title: text("title").notNull(),
    severity: uatDefectSeverity("severity").notNull(),
    status: uatDefectStatus("status").notNull().default("open"),
    raisedDate: date("raised_date").notNull(),
    resolvedDate: date("resolved_date"),
    resolutionNote: text("resolution_note"),
    referenceUri: text("reference_uri"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uat_defect_seq_idx").on(t.cycleId, t.defectNumber)],
);

// ---------------------------------------------------------------------------
// Source wiring (ADR-0005)
// ---------------------------------------------------------------------------

export const studySource = pgTable(
  "study_source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => study.id),
    adapter: text("adapter").notNull(),
    sourceStudyKey: text("source_study_key").notNull(),
    // Non-secret adapter config; credentials go through env indirection.
    config: jsonb("config").notNull().default({}),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("study_source_adapter_idx").on(t.studyId, t.adapter)],
);

// ---------------------------------------------------------------------------
// Metric warehouse (ADR-0004, ADR-0007): append-only, guarded by triggers
// ---------------------------------------------------------------------------

export const metricDefinition = pgTable(
  "metric_definition",
  {
    metricId: text("metric_id").notNull(),
    version: text("version").notNull(),
    label: text("label").notNull(),
    owner: text("owner").notNull(),
    // The YAML verbatim at registration, so a snapshot's definition is
    // reproducible even if the file later changes (ADR-0004).
    specYaml: text("spec_yaml").notNull(),
    specChecksum: char("spec_checksum", { length: 64 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.metricId, t.version] })],
);

export const sourceExtract = pgTable("source_extract", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: uuid("study_id")
    .notNull()
    .references(() => study.id),
  adapter: text("adapter").notNull(),
  extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull(),
  rowCounts: jsonb("row_counts").notNull().default({}),
  checksum: char("checksum", { length: 64 }).notNull(),
  status: extractStatus("status").notNull(),
  errorDetail: text("error_detail"),
});

export const metricSnapshot = pgTable(
  "metric_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    metricId: text("metric_id").notNull(),
    metricVersion: text("metric_version").notNull(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => study.id),
    siteId: uuid("site_id").references(() => site.id),
    grain: metricGrain("grain").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    value: numeric("value"),
    numerator: numeric("numerator"),
    denominator: numeric("denominator"),
    nRecords: integer("n_records"),
    sourceExtractId: uuid("source_extract_id").references(() => sourceExtract.id),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.metricId, t.metricVersion],
      foreignColumns: [metricDefinition.metricId, metricDefinition.version],
      name: "metric_snapshot_definition_fk",
    }),
    uniqueIndex("metric_snapshot_key_idx").on(
      t.metricId,
      t.metricVersion,
      t.studyId,
      t.siteId,
      t.periodStart,
      t.grain,
      t.computedAt,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Audit (ADR-0003) — written only by database triggers, never by application
// code; column-compatible with ctms-core's audit_event.
// ---------------------------------------------------------------------------

export const auditEvent = pgTable("audit_event", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  actorId: uuid("actor_id"),
  actorLabel: text("actor_label").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  prevHash: char("prev_hash", { length: 64 }).notNull(),
  hash: char("hash", { length: 64 }).notNull(),
});
