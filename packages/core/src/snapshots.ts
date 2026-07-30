import { type NormalizedFrames, validateExtraction } from "@dmops/adapter-contract";
import { getAdapter } from "@dmops/adapters";
import type { Sql } from "@dmops/db";
import {
  type LoadedSpec,
  type MilestoneFact,
  assertRegistryMatchesSpecs,
  computeFn,
  loadSpecs,
  metricAvailability,
} from "@dmops/metrics";

export interface RefreshResult {
  studyId: string;
  extractId: string | null;
  computed: { metricId: string; version: string; rows: number }[];
  skipped: { metricId: string; reason: string }[];
  warnings: string[];
}

/**
 * The snapshot pipeline (ADR-0005, ADR-0007): extract → validate → record a
 * checksummed source_extract → gate each metric on adapter capabilities →
 * compute → append immutable metric_snapshot rows. Runs as the owning role
 * (a scheduled job), not the API role.
 */
export async function refreshStudyMetrics(
  sql: Sql,
  studyId: string,
  period: { periodStart: string; periodEnd: string },
): Promise<RefreshResult> {
  const specs = assertRegistryMatchesSpecs(loadSpecs());
  const result: RefreshResult = {
    studyId,
    extractId: null,
    computed: [],
    skipped: [],
    warnings: [],
  };

  const [source] = await sql`
    SELECT adapter, source_study_key, config FROM study_source
    WHERE study_id = ${studyId} AND active`;

  // Split metrics into adapter-fed and dmops-native (empty source_frames).
  const adapterSpecs = specs.filter((s) => s.spec.source_frames.length > 0);
  const nativeSpecs = specs.filter((s) => s.spec.source_frames.length === 0);

  let frames: NormalizedFrames = {};
  if (source) {
    const adapter = getAdapter(source.adapter as string);
    const capabilities = adapter.capabilities();

    const runnable: LoadedSpec[] = [];
    for (const loaded of adapterSpecs) {
      const availability = metricAvailability(loaded.spec, capabilities);
      if (availability.available) runnable.push(loaded);
      else {
        result.skipped.push({
          metricId: loaded.spec.id,
          reason: `unavailable: source '${adapter.id}' missing ${availability.missing.join(", ")}`,
        });
      }
    }

    if (runnable.length > 0) {
      const neededFrames = [...new Set(runnable.flatMap((l) => l.spec.source_frames))] as (
        | "queries"
        | "subjects"
        | "visits"
        | "pages"
      )[];
      try {
        const extraction = await adapter.extract({
          sourceStudyKey: source.source_study_key as string,
          frames: neededFrames,
          config: source.config as Record<string, unknown>,
        });
        validateExtraction(extraction);
        const [extractRow] = await sql`
          INSERT INTO source_extract (study_id, adapter, extracted_at, row_counts, checksum, status)
          VALUES (${studyId}, ${adapter.id}, ${extraction.extracted_at},
                  ${JSON.stringify(extraction.row_counts)}::jsonb, ${extraction.checksum}, 'ok')
          RETURNING id`;
        result.extractId = extractRow!.id as string;
        frames = extraction.frames as NormalizedFrames;
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        await sql`
          INSERT INTO source_extract (study_id, adapter, extracted_at, checksum, status, error_detail)
          VALUES (${studyId}, ${adapter.id}, now(), ${"0".repeat(64)}, 'error', ${detail})`;
        for (const loaded of runnable) {
          result.skipped.push({ metricId: loaded.spec.id, reason: `extract failed: ${detail}` });
        }
        // dmops-native metrics still compute below.
        frames = {};
      }

      if (result.extractId) {
        const siteRows = await sql`
          SELECT id, site_number FROM site WHERE study_id = ${studyId}`;
        const siteIdByKey = new Map(siteRows.map((r) => [r.site_number as string, r.id as string]));
        for (const loaded of runnable) {
          await computeAndInsert(sql, studyId, loaded, frames, period, result, siteIdByKey);
        }
      }
    }
  } else {
    for (const loaded of adapterSpecs) {
      result.skipped.push({ metricId: loaded.spec.id, reason: "no active study_source" });
    }
  }

  // dmops-native metrics (milestone_slip): source is this system's own facts.
  if (nativeSpecs.length > 0) {
    const milestoneRows = await sql`
      SELECT code, occurrence, status, baseline_date, planned_date, forecast_date, actual_date
      FROM study_milestone WHERE study_id = ${studyId}`;
    const milestones = milestoneRows as unknown as MilestoneFact[];
    for (const loaded of nativeSpecs) {
      await computeAndInsert(sql, studyId, loaded, {}, period, result, new Map(), milestones);
    }
  }

  return result;
}

async function computeAndInsert(
  sql: Sql,
  studyId: string,
  loaded: LoadedSpec,
  frames: NormalizedFrames,
  period: { periodStart: string; periodEnd: string },
  result: RefreshResult,
  siteIdByKey: Map<string, string>,
  milestones?: MilestoneFact[],
): Promise<void> {
  const { spec } = loaded;
  const fn = computeFn(spec.id, spec.version);
  const values = fn(frames, { ...period, ...(milestones ? { milestones } : {}) });
  let inserted = 0;
  for (const v of values) {
    let siteId: string | null = null;
    if (v.grain === "site") {
      siteId = v.site_key ? (siteIdByKey.get(v.site_key) ?? null) : null;
      if (!siteId) {
        result.warnings.push(
          `${spec.id}: site grain row for source site '${v.site_key}' has no matching site record — dropped`,
        );
        continue;
      }
    }
    await sql`
      INSERT INTO metric_snapshot
        (metric_id, metric_version, study_id, site_id, grain, period_start, period_end,
         value, numerator, denominator, n_records, source_extract_id)
      VALUES
        (${spec.id}, ${spec.version}, ${studyId}, ${siteId}, ${v.grain},
         ${period.periodStart}, ${period.periodEnd},
         ${v.value}, ${v.numerator}, ${v.denominator}, ${v.n_records}, ${result.extractId})`;
    inserted++;
  }
  result.computed.push({ metricId: spec.id, version: spec.version, rows: inserted });
}
