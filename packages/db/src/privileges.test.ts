import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { appDatabaseUrl } from "./env.js";

// The runtime connection: least-privilege dmops_app role (ADR-0003).
const { sql: app } = createDb(appDatabaseUrl());
afterAll(() => app.end());

describe("runtime role privilege ceilings (ADR-0003, DM-P3)", () => {
  it("cannot create tables (no DDL)", async () => {
    await expect(app`CREATE TABLE smuggled (id int)`).rejects.toThrow(/permission denied/);
  });

  it("cannot INSERT audit_event directly (cannot fabricate audit)", async () => {
    await expect(app`
      INSERT INTO audit_event
        (occurred_at, actor_label, action, entity_type, prev_hash, hash)
      VALUES (now(), 'forger', 'person.update', 'person', repeat('0', 64), repeat('0', 64))
    `).rejects.toThrow(/permission denied/);
  });

  it("cannot TRUNCATE domain tables", async () => {
    await expect(app`TRUNCATE person CASCADE`).rejects.toThrow(/permission denied/);
  });

  it("cannot UPDATE or DELETE metric_snapshot even before the trigger fires (DM-P3)", async () => {
    await expect(app`UPDATE metric_snapshot SET value = 0`).rejects.toThrow(/permission denied/);
    await expect(app`DELETE FROM metric_snapshot`).rejects.toThrow(/permission denied/);
  });

  it("cannot disable triggers (requires table ownership)", async () => {
    await expect(
      app`ALTER TABLE audit_event DISABLE TRIGGER audit_event_immutable`,
    ).rejects.toThrow(/must be owner/);
  });

  it("still audits writes it is allowed to make, attributed via withActor settings", async () => {
    // dmops_app CAN write domain tables — that is its job; the point is the
    // write leaves a chained audit event it cannot alter.
    await app.begin(async (tx) => {
      await tx`SELECT set_config('dmops.actor_label', 'privilege-probe', true)`;
      await tx`INSERT INTO sponsor (name) VALUES ('Privilege Probe Sponsor')`;
      const [event] = await tx`SELECT * FROM audit_event ORDER BY id DESC LIMIT 1`;
      expect(event!.actor_label).toBe("privilege-probe");
      throw new Error("rollback");
    }).catch((e) => {
      if ((e as Error).message !== "rollback") throw e;
    });
  });
});
