/**
 * Sync the governed milestone taxonomy (taxonomy/milestone_definitions.yaml,
 * ADR-0008) into milestone_definition. Idempotent upsert; never deletes —
 * retiring a code is `active: false` in the YAML. Validates the dependency
 * DAG before touching the database.
 *
 * Usage: pnpm db:sync-taxonomy  (also called by the seed)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import { type Sql, createDb } from "./client.js";

const milestoneSchema = z
  .object({
    code: z.string().regex(/^[A-Z]+(\.[A-Z0-9]+)+$/, "codes are dotted uppercase identifiers"),
    label: z.string().min(1),
    phase_group: z.enum([
      "startup_spec",
      "startup_build",
      "startup_release",
      "conduct",
      "closeout",
      "analysis",
    ]),
    module: z.enum(["dm", "stat"]).default("dm"),
    sequence: z.number().int().positive(),
    default_owner_role: z
      .enum(["dm_lead", "dm_manager", "analyst", "programmer", "biostat"])
      .default("dm_lead"),
    depends_on: z.array(z.string()).default([]),
    is_repeating: z.boolean().default(false),
    active: z.boolean().default(true),
    version: z.number().int().positive().default(1),
  })
  .strict();

const taxonomySchema = z.object({ milestones: z.array(milestoneSchema).min(1) }).strict();

export type MilestoneDef = z.infer<typeof milestoneSchema>;

export function loadTaxonomy(): MilestoneDef[] {
  const path = fileURLToPath(
    new URL("../../../taxonomy/milestone_definitions.yaml", import.meta.url),
  );
  const parsed = taxonomySchema.parse(parse(readFileSync(path, "utf8")));
  const milestones = parsed.milestones;

  const codes = new Set(milestones.map((m) => m.code));
  if (codes.size !== milestones.length) {
    throw new Error("duplicate milestone codes in taxonomy");
  }
  // depends_on must reference existing codes and contain no cycles.
  for (const m of milestones) {
    for (const dep of m.depends_on) {
      if (!codes.has(dep)) throw new Error(`${m.code} depends on unknown code ${dep}`);
    }
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const byCode = new Map(milestones.map((m) => [m.code, m]));
  const visit = (code: string) => {
    if (done.has(code)) return;
    if (visiting.has(code)) throw new Error(`dependency cycle involving ${code}`);
    visiting.add(code);
    for (const dep of byCode.get(code)?.depends_on ?? []) visit(dep);
    visiting.delete(code);
    done.add(code);
  };
  for (const m of milestones) visit(m.code);

  return milestones;
}

export async function syncTaxonomy(sql: Sql): Promise<{ upserted: number }> {
  const milestones = loadTaxonomy();
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('dmops.actor_label', 'taxonomy-sync', true)`;
    for (const m of milestones) {
      await tx`
        INSERT INTO milestone_definition
          (code, label, phase_group, module, sequence, default_owner_role,
           depends_on, is_repeating, active, version)
        VALUES
          (${m.code}, ${m.label}, ${m.phase_group}, ${m.module}, ${m.sequence},
           ${m.default_owner_role}, ${m.depends_on}, ${m.is_repeating}, ${m.active}, ${m.version})
        ON CONFLICT (code) DO UPDATE SET
          label = EXCLUDED.label,
          phase_group = EXCLUDED.phase_group,
          module = EXCLUDED.module,
          sequence = EXCLUDED.sequence,
          default_owner_role = EXCLUDED.default_owner_role,
          depends_on = EXCLUDED.depends_on,
          is_repeating = EXCLUDED.is_repeating,
          active = EXCLUDED.active,
          version = EXCLUDED.version
        WHERE (milestone_definition.label, milestone_definition.phase_group,
               milestone_definition.module,
               milestone_definition.sequence, milestone_definition.default_owner_role,
               milestone_definition.depends_on, milestone_definition.is_repeating,
               milestone_definition.active, milestone_definition.version)
          IS DISTINCT FROM
              (EXCLUDED.label, EXCLUDED.phase_group, EXCLUDED.module, EXCLUDED.sequence,
               EXCLUDED.default_owner_role, EXCLUDED.depends_on,
               EXCLUDED.is_repeating, EXCLUDED.active, EXCLUDED.version)`;
    }
  });
  return { upserted: milestones.length };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const { sql } = createDb();
  const { upserted } = await syncTaxonomy(sql);
  console.log(`taxonomy synced (${upserted} definitions)`);
  await sql.end();
}
