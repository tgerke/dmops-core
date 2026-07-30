-- 0006_roster_mirrors: training and access mirrors (ADR-0013). Mirrors of
-- the LMS transcript and the source system's user administration — replaced
-- wholesale by the refresh pipeline (owning role), stamped with the extract
-- that produced them. Deliberately NOT audited (machine state with extract
-- provenance, the metric-warehouse exemption; see iq.ts AUDIT_EXEMPT) and
-- NOT writable by dmops_app: there is no endpoint that could hand-edit a
-- training status (DM-P1). person_key is the source system's identity (by
-- convention an email); no FK to person — site staff hold EDC accounts
-- without being portal users.
CREATE TYPE "access_status" AS ENUM ('active', 'locked', 'deactivated');
--> statement-breakpoint
CREATE TABLE "training_mirror" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_id" uuid NOT NULL REFERENCES "study"("id"),
  "source_extract_id" uuid NOT NULL REFERENCES "source_extract"("id"),
  "person_key" text NOT NULL,
  "person_name" text,
  "course_key" text NOT NULL,
  "course_title" text,
  "due_date" date,
  "completed_date" date,
  "expires_date" date,
  "mirrored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- One row per person × course: the current assignment state, not a history
-- (re-certification shows as the latest completion and expiry). A source
-- emitting duplicates fails the sync loudly rather than mirroring ambiguity.
CREATE UNIQUE INDEX "training_mirror_person_course_idx"
  ON "training_mirror" ("study_id", "person_key", "course_key");
--> statement-breakpoint
CREATE TABLE "access_mirror" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_id" uuid NOT NULL REFERENCES "study"("id"),
  "source_extract_id" uuid NOT NULL REFERENCES "source_extract"("id"),
  "person_key" text NOT NULL,
  "person_name" text,
  "role_key" text NOT NULL,
  "site_key" text,
  "status" "access_status" NOT NULL,
  "granted_at" timestamp with time zone,
  "mirrored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Null site_key means a study-wide grant; coalesce so the uniqueness holds
-- for those rows too (NULLS NOT DISTINCT is avoided for older Postgres).
CREATE UNIQUE INDEX "access_mirror_grant_idx"
  ON "access_mirror" ("study_id", "person_key", "role_key", (coalesce("site_key", '')));
--> statement-breakpoint
-- Structurally display-only (ADR-0006 posture, warehouse-style): the API
-- role reads mirrors, only the refresh pipeline writes them.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON training_mirror, access_mirror FROM dmops_app;
--> statement-breakpoint
-- Training status is derived at read time from the dated facts, never
-- stored (house rule). 'current' requires an unexpired completion; an
-- assignment with no due date is required now, so uncompleted means overdue.
CREATE VIEW v_study_training_status AS
SELECT
  tm.id,
  tm.study_id,
  tm.person_key,
  tm.person_name,
  tm.course_key,
  tm.course_title,
  tm.due_date,
  tm.completed_date,
  tm.expires_date,
  tm.source_extract_id,
  tm.mirrored_at,
  CASE
    WHEN tm.completed_date IS NOT NULL
      AND (tm.expires_date IS NULL OR tm.expires_date > CURRENT_DATE) THEN 'current'
    WHEN tm.completed_date IS NOT NULL THEN 'expired'
    WHEN tm.due_date IS NULL OR tm.due_date <= CURRENT_DATE THEN 'overdue'
    ELSE 'pending'
  END AS status
FROM training_mirror tm;
--> statement-breakpoint
-- The roster answers the inspection question directly (ADR-0013):
-- training_gap flags active access whose training is missing, overdue, or
-- expired — the same predicate access_training_gap (DM-Q8) snapshots.
-- Guarded on the study having any training rows at all: an unwired LMS feed
-- is a named gap in the metrics strip, not evidence that nobody is trained
-- (ADR-0005 fail-closed applied to display).
CREATE VIEW v_study_access_roster AS
WITH access AS (
  SELECT
    study_id,
    person_key,
    max(person_name) AS person_name,
    array_agg(DISTINCT role_key ORDER BY role_key) AS roles,
    array_agg(DISTINCT site_key) FILTER (WHERE site_key IS NOT NULL) AS site_keys,
    CASE
      WHEN bool_or(status = 'active') THEN 'active'
      WHEN bool_or(status = 'locked') THEN 'locked'
      ELSE 'deactivated'
    END AS account_status,
    min(granted_at) AS first_granted_at,
    max(mirrored_at) AS mirrored_at
  FROM access_mirror
  GROUP BY study_id, person_key
), training AS (
  SELECT
    study_id,
    person_key,
    count(*)::int AS trainings_on_file,
    count(*) FILTER (WHERE status = 'current')::int AS trainings_current,
    count(*) FILTER (WHERE status = 'overdue')::int AS trainings_overdue,
    count(*) FILTER (WHERE status = 'expired')::int AS trainings_expired,
    count(*) FILTER (WHERE status = 'pending')::int AS trainings_pending
  FROM v_study_training_status
  GROUP BY study_id, person_key
)
SELECT
  a.study_id,
  a.person_key,
  a.person_name,
  a.roles,
  a.site_keys,
  a.account_status,
  a.first_granted_at,
  a.mirrored_at,
  coalesce(t.trainings_on_file, 0) AS trainings_on_file,
  coalesce(t.trainings_current, 0) AS trainings_current,
  coalesce(t.trainings_overdue, 0) AS trainings_overdue,
  coalesce(t.trainings_expired, 0) AS trainings_expired,
  coalesce(t.trainings_pending, 0) AS trainings_pending,
  (a.account_status = 'active'
    AND EXISTS (SELECT 1 FROM training t2 WHERE t2.study_id = a.study_id)
    AND (t.person_key IS NULL OR t.trainings_overdue > 0 OR t.trainings_expired > 0)
  ) AS training_gap
FROM access a
LEFT JOIN training t
  ON t.study_id = a.study_id AND t.person_key = a.person_key;
