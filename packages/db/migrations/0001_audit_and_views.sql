-- 0001_audit_and_views: compliance machinery + derived views.
-- Ported from ctms-core's proven ADR-0003 machinery (this repo's ADR-0003):
-- audit and immutability hold for every write path, not just well-behaved
-- app code. Views implement derived-over-stored status (no stored roll-ups).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Immutability (DM-P3): the audit trail and the metric warehouse are
-- append-only for every role. Corrections are new rows, never edits.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dmops_forbid_mutation() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION '% rows are immutable (append-only): % rejected', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'raise_exception';
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER audit_event_immutable BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION dmops_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER metric_snapshot_immutable BEFORE UPDATE OR DELETE ON metric_snapshot
  FOR EACH ROW EXECUTE FUNCTION dmops_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER source_extract_immutable BEFORE UPDATE OR DELETE ON source_extract
  FOR EACH ROW EXECUTE FUNCTION dmops_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER metric_definition_immutable BEFORE UPDATE OR DELETE ON metric_definition
  FOR EACH ROW EXECUTE FUNCTION dmops_forbid_mutation();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Audit trail (ADR-0003): AFTER-triggers on every domain table write
-- hash-chained events. Actor identity comes from per-transaction settings
-- established by @dmops/core withActor
-- (set_config('dmops.actor_id' / 'dmops.actor_label', ..., true));
-- writes made without them are attributed to 'system'.
--
-- Chain: hash = sha256(prev_hash || action || actor_id || actor_label ||
--                      entity_id || before || after || occurred_at)
-- computed from the stored columns, so dmops_verify_audit_chain() can replay
-- and detect any retroactive edit.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dmops_audit() RETURNS trigger AS $fn$
DECLARE
  v_now timestamptz := now();
  v_actor uuid := nullif(current_setting('dmops.actor_id', true), '')::uuid;
  v_label text := coalesce(nullif(current_setting('dmops.actor_label', true), ''), 'system');
  v_prev char(64);
  v_before jsonb;
  v_after jsonb;
  v_entity_id text;
  v_action text := lower(TG_TABLE_NAME) || '.' || lower(TG_OP);
  v_hash char(64);
BEGIN
  -- Serialize chain appends; xact-scoped lock releases on commit/rollback.
  PERFORM pg_advisory_xact_lock(hashtext('dmops_audit_chain'));
  SELECT hash INTO v_prev FROM audit_event ORDER BY id DESC LIMIT 1;
  IF v_prev IS NULL THEN
    v_prev := repeat('0', 64);
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_after := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
  ELSE
    v_before := to_jsonb(OLD);
  END IF;
  -- Entity id: uuid pk where present; milestone_definition keys on code and
  -- metric_definition on (metric_id, version).
  v_entity_id := coalesce(
    v_after ->> 'id', v_before ->> 'id',
    v_after ->> 'code', v_before ->> 'code',
    concat_ws('@', coalesce(v_after ->> 'metric_id', v_before ->> 'metric_id'),
                   coalesce(v_after ->> 'version', v_before ->> 'version')));
  v_hash := encode(digest(
    v_prev || v_action || coalesce(v_actor::text, '') || v_label
      || coalesce(v_entity_id, '') || coalesce(v_before::text, '')
      || coalesce(v_after::text, '') || v_now::text,
    'sha256'), 'hex');
  INSERT INTO audit_event
    (occurred_at, actor_id, actor_label, action, entity_type, entity_id,
     before, after, prev_hash, hash)
  VALUES
    (v_now, v_actor, v_label, v_action, TG_TABLE_NAME, v_entity_id,
     v_before, v_after, v_prev, v_hash);
  RETURN coalesce(NEW, OLD);
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER sponsor_audit AFTER INSERT OR UPDATE OR DELETE ON sponsor
  FOR EACH ROW EXECUTE FUNCTION dmops_audit();
--> statement-breakpoint
CREATE TRIGGER person_audit AFTER INSERT OR UPDATE OR DELETE ON person
  FOR EACH ROW EXECUTE FUNCTION dmops_audit();
--> statement-breakpoint
CREATE TRIGGER study_audit AFTER INSERT OR UPDATE OR DELETE ON study
  FOR EACH ROW EXECUTE FUNCTION dmops_audit();
--> statement-breakpoint
CREATE TRIGGER site_audit AFTER INSERT OR UPDATE OR DELETE ON site
  FOR EACH ROW EXECUTE FUNCTION dmops_audit();
--> statement-breakpoint
CREATE TRIGGER study_assignment_audit AFTER INSERT OR UPDATE OR DELETE ON study_assignment
  FOR EACH ROW EXECUTE FUNCTION dmops_audit();
--> statement-breakpoint
CREATE TRIGGER milestone_definition_audit AFTER INSERT OR UPDATE OR DELETE ON milestone_definition
  FOR EACH ROW EXECUTE FUNCTION dmops_audit();
--> statement-breakpoint
CREATE TRIGGER study_milestone_audit AFTER INSERT OR UPDATE OR DELETE ON study_milestone
  FOR EACH ROW EXECUTE FUNCTION dmops_audit();
--> statement-breakpoint
CREATE TRIGGER deliverable_audit AFTER INSERT OR UPDATE OR DELETE ON deliverable
  FOR EACH ROW EXECUTE FUNCTION dmops_audit();
--> statement-breakpoint
CREATE TRIGGER study_source_audit AFTER INSERT OR UPDATE OR DELETE ON study_source
  FOR EACH ROW EXECUTE FUNCTION dmops_audit();
--> statement-breakpoint
-- metric_definition rows are governance actions worth attributing; they are
-- append-only, so only INSERT can fire.
CREATE TRIGGER metric_definition_audit AFTER INSERT ON metric_definition
  FOR EACH ROW EXECUTE FUNCTION dmops_audit();
--> statement-breakpoint
-- metric_snapshot and source_extract are deliberately unaudited: they are
-- machine-derived, immutable, and carry their own provenance (checksummed
-- extract lineage). Auditing them would double warehouse writes for no
-- additional evidence. Documented in iq.ts AUDIT_EXEMPT.

CREATE OR REPLACE FUNCTION dmops_verify_audit_chain()
RETURNS TABLE (event_id bigint, problem text) AS $fn$
DECLARE
  r record;
  v_prev char(64) := repeat('0', 64);
  v_expected char(64);
BEGIN
  FOR r IN SELECT * FROM audit_event ORDER BY id LOOP
    IF r.prev_hash <> v_prev THEN
      event_id := r.id; problem := 'prev_hash does not match preceding event';
      RETURN NEXT;
    END IF;
    v_expected := encode(digest(
      r.prev_hash || r.action || coalesce(r.actor_id::text, '') || r.actor_label
        || coalesce(r.entity_id, '') || coalesce(r.before::text, '')
        || coalesce(r.after::text, '') || r.occurred_at::text,
      'sha256'), 'hex');
    IF r.hash <> v_expected THEN
      event_id := r.id; problem := 'hash does not match recomputed value';
      RETURN NEXT;
    END IF;
    v_prev := r.hash;
  END LOOP;
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Derived views: status roll-ups are computed from ground truth, never stored.
-- ---------------------------------------------------------------------------

CREATE VIEW v_study_milestone_board AS
SELECT
  sm.id,
  sm.study_id,
  sm.code,
  sm.occurrence,
  md.label,
  md.phase_group,
  md.sequence,
  md.is_repeating,
  sm.baseline_date,
  sm.planned_date,
  sm.forecast_date,
  sm.actual_date,
  sm.status,
  sm.owner_id,
  p.name AS owner_name,
  sm.blocker_note,
  sm.evidence_uri,
  sm.updated_at,
  -- Slip vs plan while in flight; slip vs baseline once actual lands.
  (sm.forecast_date - sm.planned_date) AS forecast_slip_days,
  (sm.actual_date - sm.baseline_date) AS actual_slip_days
FROM study_milestone sm
JOIN milestone_definition md ON md.code = sm.code
LEFT JOIN person p ON p.id = sm.owner_id;
--> statement-breakpoint

CREATE VIEW v_study_summary AS
SELECT
  s.id AS study_id,
  s.protocol_number,
  s.short_title,
  s.phase,
  s.indication,
  s.status AS study_status,
  sp.name AS sponsor_name,
  lead.name AS dm_lead_name,
  count(sm.id) AS milestone_total,
  count(*) FILTER (WHERE sm.status = 'complete') AS milestone_complete,
  count(*) FILTER (WHERE sm.status = 'blocked') AS milestone_blocked,
  count(*) FILTER (WHERE sm.status = 'in_progress') AS milestone_in_progress,
  count(*) FILTER (WHERE sm.status = 'na') AS milestone_na,
  CASE WHEN count(*) FILTER (WHERE sm.status <> 'na') > 0
    THEN round(100.0 * count(*) FILTER (WHERE sm.status = 'complete')
      / count(*) FILTER (WHERE sm.status <> 'na'), 1)
  END AS pct_complete,
  next_ms.code AS next_milestone_code,
  next_ms.label AS next_milestone_label,
  next_ms.planned_date AS next_milestone_planned
FROM study s
LEFT JOIN sponsor sp ON sp.id = s.sponsor_id
LEFT JOIN person lead ON lead.id = s.dm_lead_id
LEFT JOIN study_milestone sm ON sm.study_id = s.id
LEFT JOIN LATERAL (
  SELECT sm2.code, md2.label, sm2.planned_date
  FROM study_milestone sm2
  JOIN milestone_definition md2 ON md2.code = sm2.code
  WHERE sm2.study_id = s.id
    AND sm2.status IN ('not_started', 'in_progress', 'blocked')
    AND sm2.planned_date IS NOT NULL
  ORDER BY sm2.planned_date ASC
  LIMIT 1
) next_ms ON true
GROUP BY s.id, sp.name, lead.name, next_ms.code, next_ms.label, next_ms.planned_date;
--> statement-breakpoint

CREATE VIEW v_metric_definition_current AS
SELECT DISTINCT ON (metric_id) *
FROM metric_definition
ORDER BY metric_id, effective_from DESC, registered_at DESC;
--> statement-breakpoint

CREATE VIEW v_metric_latest AS
SELECT DISTINCT ON (metric_id, study_id, site_id, grain) *
FROM metric_snapshot
ORDER BY metric_id, study_id, site_id, grain, computed_at DESC;
