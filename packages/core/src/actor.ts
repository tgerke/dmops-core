import type { Sql } from "@dmops/db";

/** The acting identity recorded on every audit event in the transaction. */
export interface Actor {
  personId?: string;
  label: string;
}

/**
 * Run `fn` in a transaction with the actor bound via set_config, so the
 * database audit triggers (ADR-0003) attribute every write in it. Writes
 * made outside withActor are still audited, attributed to 'system'.
 */
export async function withActor<T>(
  sql: Sql,
  actor: Actor,
  fn: (tx: Sql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`
      SELECT set_config('dmops.actor_id', ${actor.personId ?? ""}, true),
             set_config('dmops.actor_label', ${actor.label}, true)`;
    return fn(tx as unknown as Sql);
  }) as Promise<T>;
}
