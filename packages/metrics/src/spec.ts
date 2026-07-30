import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { frameNames } from "@dmops/adapter-contract";
import { parse } from "yaml";
import { z } from "zod";

/**
 * Schema for the governed metric dictionary (metrics/*.yaml, ADR-0004).
 * Unknown keys are rejected: the YAML is a definition, not a scratchpad.
 */
export const metricSpec = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(1),
    owner: z.string().min(1),
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
  }
  return loaded;
}
