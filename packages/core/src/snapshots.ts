import {
  type AccessGrantRow,
  type FrameName,
  type NormalizedFrames,
  type TrainingRecordRow,
  validateExtraction,
} from "@dmops/adapter-contract";
import { getAdapter } from "@dmops/adapters";
import type { Sql } from "@dmops/db";
import {
  type LoadedSpec,
  MIRROR_FRAMES,
  type MilestoneDefinitionFact,
  type MilestoneFact,
  assertRegistryMatchesSpecs,
  computeFn,
  loadSpecs,
  metricAvailability,
  mirrorFedAvailability,
  resolveCalendar,
} from "@dmops/metrics";

export interface RefreshResult {
  studyId: string;
  /** One entry per source that extracted this run (ADR-0012: a study can
   * have several — e.g. an EDC source and a repository source). */
  extracts: { adapter: string; extractId: string }[];
  computed: { metricId: string; version: string; rows: number }[];
  skipped: { metricId: string; reason: string }[];
  /** Roster mirrors replaced this run (ADR-0013). */
  mirrored: { frame: string; adapter: string; rows: number }[];
  warnings: string[];
}

// MIRROR_FRAMES — the frames that persist as roster mirrors (ADR-0013),
// refreshed alongside the metrics from the first active source that
// supports them — now lives in @dmops/metrics, where the dictionary schema
// validates `input: mirrors` against it (ADR-0019).

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
  const [studyRow] = await sql`SELECT modules, calendar FROM study WHERE id = ${studyId}`;
  const modules = (studyRow?.modules ?? ["dm"]) as string[];
  // The study's holiday calendar (ADR-0016): resolved before any compute so
  // a missing calendar file fails the whole refresh, never one metric.
  const holidays = studyRow?.calendar ? resolveCalendar(studyRow.calendar as string) : undefined;
  const specs = assertRegistryMatchesSpecs(loadSpecs()).filter(({ spec }) =>
    modules.includes(spec.module),
  );
  const result: RefreshResult = {
    studyId,
    extracts: [],
    computed: [],
    skipped: [],
    mirrored: [],
    warnings: [],
  };

  // A study can have several active sources (ADR-0012): each metric is
  // assigned to the first source (in adapter order, deterministic) whose
  // capabilities make it available; sources feed disjoint metric sets.
  const sources = await sql`
    SELECT adapter, source_study_key, config FROM study_source
    WHERE study_id = ${studyId} AND active
    ORDER BY adapter`;

  // Split metrics three ways (ADR-0019): fed by one source's extraction,
  // fed by the mirror tables, or dmops-native (empty source_frames).
  const adapterSpecs = specs.filter(
    (s) => s.spec.source_frames.length > 0 && s.spec.input === "extraction",
  );
  const mirrorSpecs = specs.filter((s) => s.spec.input === "mirrors");
  const nativeSpecs = specs.filter((s) => s.spec.source_frames.length === 0);

  if (sources.length === 0) {
    for (const loaded of [...adapterSpecs, ...mirrorSpecs]) {
      result.skipped.push({ metricId: loaded.spec.id, reason: "no active study_source" });
    }
  } else {
    const adapters = sources.map((s) => getAdapter(s.adapter as string));
    // Posture can depend on the study's source config (ADR-0018).
    const capabilities = adapters.map((a, i) =>
      a.capabilities(sources[i]!.config as Record<string, unknown>),
    );

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

    // Mirror frames go to the first source that supports them (ADR-0013),
    // sharing that source's extraction with any metrics it feeds.
    const mirrorBySource = new Map<number, FrameName[]>();
    for (const frame of MIRROR_FRAMES) {
      const i = capabilities.findIndex((c) => c.frames[frame]?.supported);
      if (i === -1) {
        result.warnings.push(
          `${frame}: no active source supports this frame — mirror not refreshed`,
        );
      } else {
        mirrorBySource.set(i, [...(mirrorBySource.get(i) ?? []), frame]);
      }
    }

    const siteRows = await sql`
      SELECT id, site_number FROM site WHERE study_id = ${studyId}`;
    const siteIdByKey = new Map(siteRows.map((r) => [r.site_number as string, r.id as string]));

    const sourceIndices = [...new Set([...runnableBySource.keys(), ...mirrorBySource.keys()])].sort(
      (a, b) => a - b,
    );
    // Mirror frames whose feeding source failed to extract this run: the
    // mirror keeps its previous rows for the roster, but a mirror-fed
    // metric must not quietly snapshot them (ADR-0019).
    const staleMirrorFrames = new Set<FrameName>();
    for (const i of sourceIndices) {
      const runnable = runnableBySource.get(i) ?? [];
      const mirrorFrames = mirrorBySource.get(i) ?? [];
      const source = sources[i]!;
      const adapter = adapters[i]!;
      const neededFrames = [
        ...new Set([...runnable.flatMap((l) => l.spec.source_frames), ...mirrorFrames]),
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
        for (const frame of mirrorFrames) {
          staleMirrorFrames.add(frame);
          result.warnings.push(`${frame}: extract failed — mirror keeps its previous rows`);
        }
        // Other sources and dmops-native metrics still compute.
        continue;
      }

      for (const frame of mirrorFrames) {
        const rows = await replaceMirror(sql, studyId, frame, frames[frame] ?? [], extractId);
        result.mirrored.push({ frame, adapter: adapter.id, rows });
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
          holidays,
        );
      }
    }

    // Mirror-fed metrics (ADR-0019): computed over the mirror tables after
    // every source has extracted, so the grants and the transcript may come
    // from different sources. Gated per frame against the source that feeds
    // that mirror; the snapshot cites no single extract — each mirror row
    // cites its own (the native-metric posture).
    for (const loaded of mirrorSpecs) {
      const availability = mirrorFedAvailability(loaded.spec, capabilities);
      if (!availability.available) {
        result.skipped.push({
          metricId: loaded.spec.id,
          reason: `unavailable: ${availability.missing.join(", ")}`,
        });
        continue;
      }
      const stale = (Object.keys(loaded.spec.required_fields) as FrameName[]).filter((f) =>
        staleMirrorFrames.has(f),
      );
      if (stale.length > 0) {
        result.skipped.push({
          metricId: loaded.spec.id,
          reason: `extract failed for ${stale.join(", ")} — not computed over a stale mirror`,
        });
        continue;
      }
      const frames = await readMirrorFrames(sql, studyId);
      await computeAndInsert(
        sql,
        studyId,
        loaded,
        frames,
        period,
        result,
        new Map(),
        null,
        holidays,
      );
    }
  }

  // dmops-native metrics (milestone_slip, lock_readiness_pct): source is
  // this system's own facts — milestone rows plus the definition graph for
  // metrics that derive from the taxonomy's dependencies (ADR-0014).
  // Definitions are pre-filtered to the study's enabled modules, the same
  // boundary the views apply (ADR-0011).
  if (nativeSpecs.length > 0) {
    const milestoneRows = await sql`
      SELECT code, occurrence, status, baseline_date, planned_date, forecast_date, actual_date
      FROM study_milestone WHERE study_id = ${studyId}`;
    const milestones = milestoneRows as unknown as MilestoneFact[];
    const definitionRows = await sql`
      SELECT code, depends_on, module, active FROM milestone_definition
      WHERE module = ANY (${modules}::module[])`;
    const definitions = definitionRows as unknown as MilestoneDefinitionFact[];
    for (const loaded of nativeSpecs) {
      await computeAndInsert(
        sql,
        studyId,
        loaded,
        {},
        period,
        result,
        new Map(),
        null,
        holidays,
        milestones,
        definitions,
      );
    }
  }

  return result;
}

/**
 * Replace a study's mirror rows with the just-validated extraction (ADR-0013).
 * Runs as the owning role — dmops_app cannot write mirrors — and atomically,
 * so a failed refresh keeps the previous roster instead of an empty one. The
 * mirrors are unaudited by design: provenance is the cited source_extract.
 */
async function replaceMirror(
  sql: Sql,
  studyId: string,
  frame: FrameName,
  rows: unknown[],
  extractId: string,
): Promise<number> {
  await sql.begin(async (t) => {
    const tx = t as unknown as Sql;
    if (frame === "training_records") {
      await tx`DELETE FROM training_mirror WHERE study_id = ${studyId}`;
      for (const r of rows as TrainingRecordRow[]) {
        await tx`
          INSERT INTO training_mirror
            (study_id, source_extract_id, person_key, person_name, course_key,
             course_title, due_date, completed_date, expires_date)
          VALUES
            (${studyId}, ${extractId}, ${r.person_key}, ${r.person_name}, ${r.course_key},
             ${r.course_title}, ${r.due_date}, ${r.completed_date}, ${r.expires_date})`;
      }
    } else {
      await tx`DELETE FROM access_mirror WHERE study_id = ${studyId}`;
      for (const r of rows as AccessGrantRow[]) {
        await tx`
          INSERT INTO access_mirror
            (study_id, source_extract_id, person_key, person_name, role_key,
             site_key, status, granted_at)
          VALUES
            (${studyId}, ${extractId}, ${r.person_key}, ${r.person_name}, ${r.role_key},
             ${r.site_key}, ${r.status}, ${r.granted_at})`;
      }
    }
  });
  return rows.length;
}

/**
 * Read the two mirror tables back into contract frames (ADR-0019). The rows
 * are the same validated rows the refresh wrote — the mirror is the record
 * of "training and access as this refresh saw them", which is exactly what
 * the mirror-fed compute should see, and what the roster view displays.
 */
async function readMirrorFrames(sql: Sql, studyId: string): Promise<NormalizedFrames> {
  const trainingRows = await sql`
    SELECT person_key, person_name, course_key, course_title,
           due_date, completed_date, expires_date
    FROM training_mirror WHERE study_id = ${studyId}`;
  const accessRows = await sql`
    SELECT person_key, person_name, role_key, site_key, status, granted_at
    FROM access_mirror WHERE study_id = ${studyId}`;
  const iso = (v: unknown): string | null =>
    v == null ? null : new Date(v as string).toISOString();
  return {
    training_records: trainingRows.map((r) => ({
      person_key: r.person_key,
      person_name: r.person_name,
      course_key: r.course_key,
      course_title: r.course_title,
      due_date: r.due_date,
      completed_date: r.completed_date,
      expires_date: r.expires_date,
    })) as TrainingRecordRow[],
    access_grants: accessRows.map((r) => ({
      person_key: r.person_key,
      person_name: r.person_name,
      role_key: r.role_key,
      site_key: r.site_key,
      status: r.status,
      granted_at: iso(r.granted_at),
    })) as AccessGrantRow[],
  };
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
  holidays?: string[],
  milestones?: MilestoneFact[],
  definitions?: MilestoneDefinitionFact[],
): Promise<void> {
  const { spec } = loaded;
  const fn = computeFn(spec.id, spec.version);
  const values = fn(frames, {
    ...period,
    ...(holidays ? { holidays } : {}),
    ...(milestones ? { milestones } : {}),
    ...(definitions ? { definitions } : {}),
  });
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
