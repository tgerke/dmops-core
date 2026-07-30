import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";

const { sql } = createDb();
afterAll(() => sql.end());

const ROLLBACK = new Error("rollback");
/** Run mutations in a transaction that always rolls back. */
async function inRollback(fn: (tx: typeof sql) => Promise<void>) {
  await sql
    .begin(async (tx) => {
      await fn(tx as unknown as typeof sql);
      throw ROLLBACK;
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
}

describe("append-only warehouse and audit trail (DM-P3)", () => {
  it("rejects UPDATE on audit_event at the database level", async () => {
    await expect(sql`UPDATE audit_event SET actor_label = 'tampered' WHERE id = 1`).rejects.toThrow(
      /immutable/,
    );
  });

  it("rejects DELETE on audit_event", async () => {
    await expect(sql`DELETE FROM audit_event WHERE id = 1`).rejects.toThrow(/immutable/);
  });

  it("rejects UPDATE and DELETE on metric_snapshot", async () => {
    await expect(sql`UPDATE metric_snapshot SET value = 0`).rejects.toThrow(/immutable/);
    await expect(sql`DELETE FROM metric_snapshot`).rejects.toThrow(/immutable/);
  });

  it("rejects UPDATE and DELETE on source_extract", async () => {
    await expect(sql`UPDATE source_extract SET checksum = repeat('0', 64)`).rejects.toThrow(
      /immutable/,
    );
    await expect(sql`DELETE FROM source_extract`).rejects.toThrow(/immutable/);
  });

  it("rejects UPDATE and DELETE on metric_definition (a changed definition is a new version)", async () => {
    await expect(sql`UPDATE metric_definition SET spec_yaml = 'rewritten'`).rejects.toThrow(
      /immutable/,
    );
    await expect(sql`DELETE FROM metric_definition`).rejects.toThrow(/immutable/);
  });

  it("rejects UPDATE and DELETE on milestone_rebaseline (a re-baseline is history, ADR-0009)", async () => {
    await expect(sql`UPDATE milestone_rebaseline SET reason = 'rewritten'`).rejects.toThrow(
      /immutable/,
    );
    await expect(sql`DELETE FROM milestone_rebaseline`).rejects.toThrow(/immutable/);
  });
});

describe("audit trail (ADR-0003)", () => {
  it("writes an attributed, chained event for every domain mutation", async () => {
    await inRollback(async (tx) => {
      await tx`SELECT set_config('dmops.actor_label', 'vitest', true)`;
      await tx`INSERT INTO sponsor (name) VALUES ('Audit Probe Sponsor')`;
      const [event] = await tx`
        SELECT * FROM audit_event ORDER BY id DESC LIMIT 1`;
      expect(event!.action).toBe("sponsor.insert");
      expect(event!.actor_label).toBe("vitest");
      expect(event!.after.name).toBe("Audit Probe Sponsor");
      expect(event!.hash).toMatch(/^[0-9a-f]{64}$/);
      const [prev] = await tx`
        SELECT hash FROM audit_event WHERE id = ${event!.id - 1}`;
      expect(event!.prev_hash).toBe(prev!.hash);
    });
  });

  it("verifies clean on untampered data", async () => {
    const problems = await sql`SELECT * FROM dmops_verify_audit_chain()`;
    expect(problems).toHaveLength(0);
  });

  it("detects tampering when a row is altered with triggers disabled", async () => {
    await inRollback(async (tx) => {
      await tx`ALTER TABLE audit_event DISABLE TRIGGER audit_event_immutable`;
      await tx`UPDATE audit_event SET actor_label = 'evil' WHERE id = 2`;
      const problems = await tx`SELECT * FROM dmops_verify_audit_chain()`;
      expect(problems.length).toBeGreaterThan(0);
      expect(problems[0]!.problem).toMatch(/hash does not match/);
    });
    // rollback restored reality
    const clean = await sql`SELECT * FROM dmops_verify_audit_chain()`;
    expect(clean).toHaveLength(0);
  });
});

describe("display-only posture (DM-P4)", () => {
  it("has no signature columns anywhere in the schema", async () => {
    const rows = await sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name ILIKE '%signature%' OR column_name ILIKE '%signed%')`;
    expect(rows).toHaveLength(0);
  });

  it("stores deliverable evidence as an eTMF pointer, not content", async () => {
    const columns = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'deliverable'`;
    const names = columns.map((c) => c.column_name as string);
    expect(names).toContain("etmf_uri");
    expect(names.some((n) => /content|file|blob|body/.test(n))).toBe(false);
  });
});
