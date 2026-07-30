import { type FrameName, type NormalizedFrames, validateExtraction } from "@dmops/adapter-contract";
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
  /** One entry per source that extracted this run (ADR-0012: a study can
   * have several — e.g. an EDC source and a repository source). */
  extracts: { adapter: string; extractId: string }[];
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
  // Metrics for a module the study has not enabled are out of scope, not
  // skipped-with-reason: the module boundary hides them entirely (ADR-0011).
  const [studyRow] = await sql`SELECT modules FROM study WHERE id = ${studyId}`;
  const modules = (studyRow?.modules ?? ["dm"]) as string[];
  const specs = assertRegistryMatchesSpecs(loadSpecs()).filter(({ spec }) =>
    modules.includes(spec.module),
  );
  const result: RefreshResult = {
    studyId,
    extracts: [],
    computed: [],
    skipped: [],
    warnings: [],
  };

  // A study can have several active sources (ADR-0012): each metric is
  // assigned to the first source (in adapter order, deterministic) whose
  // capabilities make it available; sources feed disjoint metric sets.
  const sources = await sql`
    SELECT adapter, source_study_key, config FROM study_source
    WHERE study_id = ${studyId} AND active
    ORDER BY adapter`;

  // Split metrics into adapter-fed and dmops-native (empty source_frames).
  const adapterSpecs = specs.filter((s) => s.spec.source_frames.length > 0);
  const nativeSpecs = specs.filter((s) => s.spec.source_frames.length === 0);

  if (sources.length === 0) {
    for (const loaded of adapterSpecs) {
      result.skipped.push({ metricId: loaded.spec.id, reason: "no active study_source" });
    }
  } else {
    const adapters = sources.map((s) => getAdapter(s.adapter as string));
    const capabilities = adapters.map((a) => a.capabilities());

    const runnableBySource = new Map<number, LoadedSpec[]>();
    for (const loaded of adapterSpecs) {
      const gaps: string[] = [];
      let assigned = false;
      for (let i = 0; i < sources.length; i++) {
        const availability = metricAvailability(loaded.spec, capabilities[i]!);
        if (availability.available) {
          runnableBySource.set(i, [...(runnableBySource.get(i) ?? []), loaded]);
          assigned = true;
          break;
        }
        gaps.push(`source '${adapters[i]!.id}' missing ${availability.missing.join(", ")}`);
      }
      if (!assigned) {
        result.skipped.push({
          metricId: loaded.spec.id,
          reason: `unavailable: ${gaps.join("; ")}`,
        });
      }
    }

    const siteRows = await sql`
      SELECT id, site_number FROM site WHERE study_id = ${studyId}`;
    const siteIdByKey = new Map(siteRows.map((r) => [r.site_number as string, r.id as string]));

    for (const [i, runnable] of runnableBySource) {
      const source = sources[i]!;
      const adapter = adapters[i]!;
      const neededFrames = [
        ...new Set(runnable.flatMap((l) => l.spec.source_frames)),
      ] as FrameName[];
      let extractId: string | null = null;
      let frames: NormalizedFrames = {};
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
        extractId = extractRow!.id as string;
        result.extracts.push({ adapter: adapter.id, extractId });
        frames = extraction.frames as NormalizedFrames;
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        await sql`
          INSERT INTO source_extract (study_id, adapter, extracted_at, checksum, status, error_detail)
          VALUES (${studyId}, ${adapter.id}, now(), ${"0".repeat(64)}, 'error', ${detail})`;
        for (const loaded of runnable) {
          result.skipped.push({ metricId: loaded.spec.id, reason: `extract failed: ${detail}` });
        }
        // Other sources and dmops-native metrics still compute.
        continue;
      }

      for (const loaded of runnable) {
        await computeAndInsert(
          sql,
          studyId,
          loaded,
          frames,
          period,
          result,
          siteIdByKey,
          extractId,
        );
      }
    }
  }

  // dmops-native metrics (milestone_slip): source is this system's own facts.
  if (nativeSpecs.length > 0) {
    const milestoneRows = await sql`
      SELECT code, occurrence, status, baseline_date, planned_date, forecast_date, actual_date
      FROM study_milestone WHERE study_id = ${studyId}`;
    const milestones = milestoneRows as unknown as MilestoneFact[];
    for (const loaded of nativeSpecs) {
      await computeAndInsert(sql, studyId, loaded, {}, period, result, new Map(), null, milestones);
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
  extractId: string | null,
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
         ${v.value}, ${v.numerator}, ${v.denominator}, ${v.n_records}, ${extractId})`;
    inserted++;
  }
  result.computed.push({ metricId: spec.id, version: spec.version, rows: inserted });
}
