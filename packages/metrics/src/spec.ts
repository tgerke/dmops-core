import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type FrameName, frameNames } from "@dmops/adapter-contract";
import { parse } from "yaml";
import { z } from "zod";

// The two frames that persist as roster mirrors (ADR-0013) — the only legal
// source_frames for a mirror-fed metric (ADR-0019). The snapshot pipeline
// refreshes exactly this set.
export const MIRROR_FRAMES = [
  "training_records",
  "access_grants",
] as const satisfies readonly FrameName[];

/**
 * Schema for the governed metric dictionary (metrics/*.yaml, ADR-0004).
 * Unknown keys are rejected: the YAML is a definition, not a scratchpad.
 */
export const metricSpec = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(1),
    owner: z.string().min(1),
    // Discipline module (ADR-0011): metrics for a module a study has not
    // enabled are filtered out, not reported unavailable.
    module: z.enum(["dm", "stat"]).default("dm"),
    version: z.string().regex(/^\d+\.\d+$/),
    grain: z.array(z.enum(["study", "site", "country", "portfolio"])).min(1),
    definition: z
      .string()
      .min(20, "write the full definition; ambiguity here causes metric disputes"),
    clock_start: z.string(),
    clock_stop: z.string(),
    calendar: z.enum(["calendar_days", "business_days"]),
    include: z.array(z.string()).default([]),
    exclude: z.array(z.string()).default([]),
    source_frames: z.array(z.enum(frameNames as [string, ...string[]])).default([]),
    // Sourcing posture (ADR-0019): frames from one source's extraction, or
    // the mirror tables the pipeline maintains (cross-source by design).
    input: z.enum(["extraction", "mirrors"]).default("extraction"),
    required_fields: z.record(z.string(), z.array(z.string())).default({}),
    refresh: z.enum(["daily", "weekly", "on_demand"]),
    target: z.string().optional(),
  })
  .strict();

export type MetricSpec = z.infer<typeof metricSpec>;

export interface LoadedSpec {
  spec: MetricSpec;
  /** File content verbatim — registered into metric_definition (ADR-0004). */
  raw: string;
  /** sha256 of raw; a changed file with an unchanged version is a hard error. */
  checksum: string;
  file: string;
}

/** Parse one registered definition (metric_definition.spec_yaml) back into a
 * typed spec — the KPI pack serves the registered copy, not the working tree
 * (ADR-0016). */
export function parseSpec(raw: string): MetricSpec {
  return metricSpec.parse(parse(raw));
}

export function defaultMetricsDir(): string {
  return fileURLToPath(new URL("../../../metrics", import.meta.url));
}

export function loadSpecs(dir: string = defaultMetricsDir()): LoadedSpec[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();
  const loaded = files.map((file) => {
    const raw = readFileSync(join(dir, file), "utf8");
    const spec = metricSpec.parse(parse(raw));
    return { spec, raw, checksum: createHash("sha256").update(raw).digest("hex"), file };
  });
  const ids = new Set(loaded.map((l) => l.spec.id));
  if (ids.size !== loaded.length) throw new Error("duplicate metric ids in dictionary");
  for (const l of loaded) {
    for (const frame of Object.keys(l.spec.required_fields)) {
      if (!l.spec.source_frames.includes(frame)) {
        throw new Error(
          `${l.spec.id}: required_fields names frame '${frame}' not in source_frames`,
        );
      }
    }
    if (l.spec.input === "mirrors") {
      const illegal = l.spec.source_frames.filter(
        (f) => !(MIRROR_FRAMES as readonly string[]).includes(f),
      );
      if (l.spec.source_frames.length === 0 || illegal.length > 0) {
        const got = illegal.length ? `; got ${illegal.join(", ")}` : "";
        throw new Error(
          `${l.spec.id}: input 'mirrors' requires source_frames within [${MIRROR_FRAMES.join(", ")}]${got}`,
        );
      }
    }
  }
  return loaded;
}
