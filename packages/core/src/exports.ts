import type { Sql } from "@dmops/db";
import { assertRegistryMatchesSpecs, loadCalendars, loadSpecs, parseSpec } from "@dmops/metrics";
import { type Portfolio, portfolioRollup } from "./portfolio.js";

/**
 * Exports and KPI packs (ADR-0016). Every function here re-serves stored
 * facts — the snapshot warehouse, the registered definitions, the extract
 * provenance — and computes nothing. A CSV is the corresponding JSON read
 * flattened; the pack is the period's snapshots with their citations
 * attached. Nothing is stored: regenerating a pack for a past period
 * reproduces it from immutable rows (ADR-0007).
 */

/** RFC 4180-style escaping: quote when a field contains a comma, quote, or newline. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvField).join(",")];
  for (const row of rows) lines.push(row.map(csvField).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

const SNAPSHOT_CSV_HEADERS = [
  "metric_id",
  "metric_version",
  "grain",
  "site_number",
  "period_start",
  "period_end",
  "value",
  "numerator",
  "denominator",
  "n_records",
  "computed_at",
  "source_extract_id",
  "source_adapter",
  "extract_checksum",
];

/**
 * A study's full snapshot history as one flat file, provenance included:
 * the same immutable rows GET /studies/:id/metrics/:metricId/snapshots
 * serves (DM-P3), with the cited extract's adapter and checksum joined on —
 * a file that leaves the system must answer for itself.
 */
export async function studySnapshotsCsv(sql: Sql, studyId: string): Promise<string> {
  const rows = await sql`
    SELECT ms.metric_id, ms.metric_version, ms.grain, s.site_number,
           ms.period_start, ms.period_end, ms.value, ms.numerator,
           ms.denominator, ms.n_records, ms.computed_at,
           ms.source_extract_id, se.adapter AS source_adapter,
           se.checksum AS extract_checksum
    FROM metric_snapshot ms
    LEFT JOIN site s ON s.id = ms.site_id
    LEFT JOIN source_extract se ON se.id = ms.source_extract_id
    WHERE ms.study_id = ${studyId}
    ORDER BY ms.period_start DESC, ms.metric_id, ms.grain, s.site_number NULLS FIRST,
             ms.computed_at DESC`;
  return toCsv(
    SNAPSHOT_CSV_HEADERS,
    rows.map((r) => SNAPSHOT_CSV_HEADERS.map((h) => r[h])),
  );
}

const PORTFOLIO_CSV_HEADERS = [
  "row_type",
  "module",
  "metric_id",
  "metric_version",
  "label",
  "pooling",
  "studies_in_scope",
  "studies_reporting",
  "poolable",
  "not_pooled_reason",
  "pooled_numerator",
  "pooled_denominator",
  "pooled_pct",
  "min_value",
  "max_value",
  "earliest_period_end",
  "latest_period_end",
  "protocol_number",
  "study_value",
  "study_n_records",
  "study_period_end",
];

/**
 * The portfolio roll-up flattened (ADR-0015 re-served, ADR-0016): one
 * `rollup` row per metric, followed by `study` rows for the per-study
 * spread wherever pooling declined. The empty pooled cells stay empty —
 * the CSV keeps the named absence, it does not fill it in.
 */
export async function portfolioCsv(sql: Sql): Promise<string> {
  const portfolio: Portfolio = await portfolioRollup(sql);
  const rows: unknown[][] = [];
  for (const m of portfolio.metrics) {
    rows.push([
      "rollup",
      m.module,
      m.metric_id,
      m.version,
      m.label,
      m.pooling,
      m.studies_in_scope,
      m.studies_reporting,
      m.poolable,
      m.not_pooled_reason,
      m.pooled?.numerator ?? null,
      m.pooled?.denominator ?? null,
      m.pooled?.pct ?? null,
      m.min_value,
      m.max_value,
      m.earliest_period_end,
      m.latest_period_end,
      null,
      null,
      null,
      null,
    ]);
    for (const s of m.per_study) {
      rows.push([
        "study",
        m.module,
        m.metric_id,
        s.metric_version,
        m.label,
        m.pooling,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        s.protocol_number,
        s.value,
        s.n_records,
        s.period_end,
      ]);
    }
  }
  return toCsv(PORTFOLIO_CSV_HEADERS, rows);
}

export interface PackSnapshot {
  metric_version: string;
  grain: string;
  site_number: string | null;
  period_start: string;
  period_end: string;
  value: string | null;
  numerator: string | null;
  denominator: string | null;
  n_records: number | null;
  computed_at: string;
  source_extract_id: string | null;
}

export interface PackMetric {
  metric_id: string;
  /** The snapshot's registered version when one exists, else the current dictionary version. */
  version: string;
  label: string;
  module: string;
  target: string | null;
  /** The registered definition text for that version (ADR-0004), verbatim. */
  definition: string;
  /** Named absence when the period has no snapshot (ADR-0005). */
  absence: string | null;
  snapshot: PackSnapshot | null;
  sites: PackSnapshot[];
}

export interface PackExtract {
  id: string;
  adapter: string;
  extracted_at: string;
  checksum: string;
  row_counts: Record<string, number> | null;
}

export interface KpiPack {
  study: {
    study_id: string;
    protocol_number: string;
    short_title: string | null;
    phase: string | null;
    indication: string | null;
    status: string;
    sponsor_name: string | null;
    dm_lead_name: string | null;
    modules: string[];
    calendar: { id: string; label: string | null } | null;
  };
  period: { start: string; end: string };
  /** Every reporting period with snapshots, newest first (YYYY-MM). */
  available_periods: string[];
  generated_at: string;
  generated_by: string;
  metrics: PackMetric[];
  provenance: { extracts: PackExtract[] };
}

/**
 * The KPI pack (ADR-0016): one period's snapshots for one study, each metric
 * carrying its registered definition and the whole carrying its extract
 * citations. Returns null when the study has no snapshots for the requested
 * period (or none at all) — the route turns that into a 404, not an empty
 * pack that reads as "all metrics absent".
 */
export async function kpiPack(
  sql: Sql,
  studyId: string,
  opts: { period?: string; generatedBy: string },
): Promise<KpiPack | null> {
  const [study] = await sql`
    SELECT v.protocol_number, v.short_title, v.phase, v.indication,
           v.study_status, v.sponsor_name, v.dm_lead_name,
           st.modules, st.calendar
    FROM v_study_summary v
    JOIN study st ON st.id = v.study_id
    WHERE v.study_id = ${studyId}`;
  if (!study) return null;
  const modules = study.modules as string[];

  const periodRows = await sql`
    SELECT DISTINCT period_start, period_end FROM metric_snapshot
    WHERE study_id = ${studyId}
    ORDER BY period_start DESC`;
  if (periodRows.length === 0) return null;
  const availablePeriods = periodRows.map((r) => String(r.period_start).slice(0, 7));
  const chosen = opts.period
    ? periodRows.find((r) => String(r.period_start).slice(0, 7) === opts.period)
    : periodRows[0];
  if (!chosen) return null;

  // Latest compute per (metric, grain, site) within the period: immutable
  // rows accumulate on recompute, the pack serves the newest (ADR-0007).
  const snapshots = await sql`
    SELECT DISTINCT ON (ms.metric_id, ms.grain, ms.site_id)
           ms.metric_id, ms.metric_version, ms.grain, s.site_number,
           ms.period_start, ms.period_end, ms.value, ms.numerator,
           ms.denominator, ms.n_records, ms.computed_at, ms.source_extract_id
    FROM metric_snapshot ms
    LEFT JOIN site s ON s.id = ms.site_id
    WHERE ms.study_id = ${studyId} AND ms.period_start = ${chosen.period_start as string}
    ORDER BY ms.metric_id, ms.grain, ms.site_id, ms.computed_at DESC`;

  const packSnapshot = (r: Record<string, unknown>): PackSnapshot => ({
    metric_version: r.metric_version as string,
    grain: r.grain as string,
    site_number: (r.site_number ?? null) as string | null,
    period_start: String(r.period_start),
    period_end: String(r.period_end),
    value: (r.value ?? null) as string | null,
    numerator: (r.numerator ?? null) as string | null,
    denominator: (r.denominator ?? null) as string | null,
    n_records: r.n_records === null ? null : Number(r.n_records),
    computed_at: new Date(r.computed_at as string).toISOString(),
    source_extract_id: (r.source_extract_id ?? null) as string | null,
  });

  // The pack serves the registered copy of each definition (ADR-0004), at
  // the version the snapshot was computed under.
  const definitionRows = await sql`
    SELECT metric_id, version, spec_yaml FROM metric_definition`;
  const registered = new Map(
    definitionRows.map((r) => [`${r.metric_id}@${r.version}`, r.spec_yaml as string]),
  );

  const specs = assertRegistryMatchesSpecs(loadSpecs()).filter(({ spec }) =>
    modules.includes(spec.module),
  );
  const metrics: PackMetric[] = specs.map(({ spec }) => {
    const studyRow = snapshots.find((r) => r.metric_id === spec.id && r.grain === "study");
    const version = studyRow ? (studyRow.metric_version as string) : spec.version;
    const raw = registered.get(`${spec.id}@${version}`);
    const registeredSpec = raw ? parseSpec(raw) : spec;
    return {
      metric_id: spec.id,
      version,
      label: registeredSpec.label,
      module: registeredSpec.module,
      target: registeredSpec.target ?? null,
      definition: registeredSpec.definition,
      absence: studyRow ? null : "no snapshot for this reporting period",
      snapshot: studyRow ? packSnapshot(studyRow) : null,
      sites: snapshots
        .filter((r) => r.metric_id === spec.id && r.grain === "site")
        .map(packSnapshot),
    };
  });

  const extractIds = [
    ...new Set(
      snapshots.map((r) => r.source_extract_id as string | null).filter((id): id is string => !!id),
    ),
  ];
  const extracts =
    extractIds.length === 0
      ? []
      : await sql`
          SELECT id, adapter, extracted_at, checksum, row_counts
          FROM source_extract WHERE id = ANY (${extractIds}::uuid[])
          ORDER BY extracted_at`;

  const calendarId = study.calendar as string | null;
  const calendar = calendarId
    ? {
        id: calendarId,
        label: loadCalendars().find((c) => c.id === calendarId)?.label ?? null,
      }
    : null;

  return {
    study: {
      study_id: studyId,
      protocol_number: study.protocol_number as string,
      short_title: (study.short_title ?? null) as string | null,
      phase: (study.phase ?? null) as string | null,
      indication: (study.indication ?? null) as string | null,
      status: study.study_status as string,
      sponsor_name: (study.sponsor_name ?? null) as string | null,
      dm_lead_name: (study.dm_lead_name ?? null) as string | null,
      modules,
      calendar,
    },
    period: { start: String(chosen.period_start), end: String(chosen.period_end) },
    available_periods: availablePeriods,
    generated_at: new Date().toISOString(),
    generated_by: opts.generatedBy,
    metrics,
    provenance: {
      extracts: extracts.map((e) => ({
        id: e.id as string,
        adapter: e.adapter as string,
        extracted_at: new Date(e.extracted_at as string).toISOString(),
        checksum: e.checksum as string,
        row_counts: (e.row_counts ?? null) as Record<string, number> | null,
      })),
    },
  };
}
