-- 0000_init: registry, milestones, deliverables, source wiring, metric
-- warehouse, audit table. Hand-written; the Drizzle schema in
-- packages/db/src/schema.ts mirrors this DDL. See ADR-0001..0008.
CREATE TYPE "study_status" AS ENUM ('planning', 'startup', 'enrolling', 'followup', 'closeout', 'locked', 'archived');
--> statement-breakpoint
CREATE TYPE "assignment_role" AS ENUM ('dm_lead', 'dm_manager', 'analyst', 'programmer', 'clinops', 'biostat', 'sponsor_user', 'qa', 'admin');
--> statement-breakpoint
CREATE TYPE "milestone_status" AS ENUM ('not_started', 'in_progress', 'complete', 'blocked', 'na');
--> statement-breakpoint
CREATE TYPE "phase_group" AS ENUM ('startup_spec', 'startup_build', 'startup_release', 'conduct', 'closeout');
--> statement-breakpoint
CREATE TYPE "deliverable_status" AS ENUM ('draft', 'in_review', 'approved', 'superseded');
--> statement-breakpoint
CREATE TYPE "extract_status" AS ENUM ('ok', 'error');
--> statement-breakpoint
CREATE TYPE "metric_grain" AS ENUM ('study', 'site', 'country', 'portfolio');
--> statement-breakpoint
CREATE TABLE "sponsor" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "org" text,
  "active" boolean DEFAULT true NOT NULL,
  CONSTRAINT "person_email_unique" UNIQUE ("email")
);
--> statement-breakpoint
CREATE TABLE "study" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "protocol_number" text NOT NULL,
  "short_title" text,
  "sponsor_id" uuid REFERENCES "sponsor"("id"),
  "phase" text,
  "indication" text,
  "therapeutic_area" text,
  "status" "study_status" DEFAULT 'planning' NOT NULL,
  "dm_lead_id" uuid REFERENCES "person"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "study_protocol_number_unique" UNIQUE ("protocol_number")
);
--> statement-breakpoint
CREATE TABLE "site" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_id" uuid NOT NULL REFERENCES "study"("id"),
  "site_number" text NOT NULL,
  "name" text,
  "country" text,
  "pi_name" text,
  "activation_date" date
);
--> statement-breakpoint
CREATE UNIQUE INDEX "site_study_number_idx" ON "site" ("study_id", "site_number");
--> statement-breakpoint
CREATE TABLE "study_assignment" (
  "study_id" uuid NOT NULL REFERENCES "study"("id"),
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "role" "assignment_role" NOT NULL,
  "start_date" date,
  "end_date" date,
  CONSTRAINT "study_assignment_pk" PRIMARY KEY ("study_id", "person_id", "role")
);
--> statement-breakpoint
CREATE TABLE "milestone_definition" (
  "code" text PRIMARY KEY NOT NULL,
  "label" text NOT NULL,
  "phase_group" "phase_group" NOT NULL,
  "sequence" integer NOT NULL,
  "default_owner_role" "assignment_role" DEFAULT 'dm_lead' NOT NULL,
  "depends_on" text[] DEFAULT '{}' NOT NULL,
  "is_repeating" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_milestone" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_id" uuid NOT NULL REFERENCES "study"("id"),
  "code" text NOT NULL REFERENCES "milestone_definition"("code"),
  "occurrence" integer DEFAULT 1 NOT NULL,
  "baseline_date" date,
  "planned_date" date,
  "forecast_date" date,
  "actual_date" date,
  "status" "milestone_status" DEFAULT 'not_started' NOT NULL,
  "owner_id" uuid REFERENCES "person"("id"),
  "blocker_note" text,
  "evidence_uri" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "study_milestone_occurrence_idx" ON "study_milestone" ("study_id", "code", "occurrence");
--> statement-breakpoint
-- Status + eTMF pointer only; structurally no signature columns, ever (ADR-0006).
CREATE TABLE "deliverable" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_id" uuid NOT NULL REFERENCES "study"("id"),
  "type" text NOT NULL,
  "title" text NOT NULL,
  "version" text,
  "status" "deliverable_status" DEFAULT 'draft' NOT NULL,
  "approved_date" date,
  "etmf_uri" text,
  "owner_id" uuid REFERENCES "person"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_source" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_id" uuid NOT NULL REFERENCES "study"("id"),
  "adapter" text NOT NULL,
  "source_study_key" text NOT NULL,
  "config" jsonb DEFAULT '{}' NOT NULL,
  "active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "study_source_adapter_idx" ON "study_source" ("study_id", "adapter");
--> statement-breakpoint
-- No effective_to: the current version is derived (v_metric_definition_current),
-- and an append-only table cannot be UPDATEd to close a validity window (ADR-0007).
CREATE TABLE "metric_definition" (
  "metric_id" text NOT NULL,
  "version" text NOT NULL,
  "label" text NOT NULL,
  "owner" text NOT NULL,
  "spec_yaml" text NOT NULL,
  "spec_checksum" char(64) NOT NULL,
  "effective_from" date NOT NULL,
  "registered_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "metric_definition_pk" PRIMARY KEY ("metric_id", "version")
);
--> statement-breakpoint
-- The data-integrity backbone: every published number traces to a checksummed
-- extract with a timestamp (ADR-0005, ADR-0007).
CREATE TABLE "source_extract" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_id" uuid NOT NULL REFERENCES "study"("id"),
  "adapter" text NOT NULL,
  "extracted_at" timestamp with time zone NOT NULL,
  "row_counts" jsonb DEFAULT '{}' NOT NULL,
  "checksum" char(64) NOT NULL,
  "status" "extract_status" NOT NULL,
  "error_detail" text
);
--> statement-breakpoint
CREATE TABLE "metric_snapshot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "metric_id" text NOT NULL,
  "metric_version" text NOT NULL,
  "study_id" uuid NOT NULL REFERENCES "study"("id"),
  "site_id" uuid REFERENCES "site"("id"),
  "grain" "metric_grain" NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "value" numeric,
  "numerator" numeric,
  "denominator" numeric,
  "n_records" integer,
  "source_extract_id" uuid REFERENCES "source_extract"("id"),
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "metric_snapshot_definition_fk" FOREIGN KEY ("metric_id", "metric_version") REFERENCES "metric_definition"("metric_id", "version")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshot_key_idx" ON "metric_snapshot" ("metric_id", "metric_version", "study_id", "site_id", "period_start", "grain", "computed_at");
--> statement-breakpoint
CREATE TABLE "audit_event" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "actor_id" uuid,
  "actor_label" text NOT NULL,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "before" jsonb,
  "after" jsonb,
  "prev_hash" char(64) NOT NULL,
  "hash" char(64) NOT NULL
);
