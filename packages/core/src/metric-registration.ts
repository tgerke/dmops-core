import type { Sql } from "@dmops/db";
import { assertRegistryMatchesSpecs, loadSpecs } from "@dmops/metrics";

/**
 * Register the governed dictionary (metrics/*.yaml) into metric_definition
 * (ADR-0004). Idempotent for unchanged files; a changed file with an
 * unchanged version is a hard error — the governance rule "changing a
 * definition creates a new version" enforced in code.
 */
export async function registerMetrics(
  sql: Sql,
  actorLabel = "metric-registration",
): Promise<{ registered: number; unchanged: number }> {
  const specs = assertRegistryMatchesSpecs(loadSpecs());
  let registered = 0;
  let unchanged = 0;
  for (const { spec, raw, checksum } of specs) {
    const [existing] = await sql`
      SELECT spec_checksum FROM metric_definition
      WHERE metric_id = ${spec.id} AND version = ${spec.version}`;
    if (existing) {
      if (existing.spec_checksum !== checksum) {
        throw new Error(
          `metrics/${spec.id}: file changed but version is still ${spec.version} — a changed definition is a new version (ADR-0004)`,
        );
      }
      unchanged++;
      continue;
    }
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('dmops.actor_label', ${actorLabel}, true)`;
      await tx`
        INSERT INTO metric_definition
          (metric_id, version, label, owner, spec_yaml, spec_checksum, effective_from)
        VALUES
          (${spec.id}, ${spec.version}, ${spec.label}, ${spec.owner},
           ${raw}, ${checksum}, CURRENT_DATE)`;
    });
    registered++;
  }
  return { registered, unchanged };
}
