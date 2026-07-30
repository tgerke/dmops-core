import type { Sql } from "@dmops/db";
import { type Actor, withActor } from "./actor.js";

export type DeliverableStatus = "draft" | "in_review" | "approved" | "superseded";

export interface DeliverableRow {
  id: string;
  study_id: string;
  type: string;
  title: string;
  version: string | null;
  status: DeliverableStatus;
  approved_date: string | null;
  etmf_uri: string | null;
  owner_id: string | null;
  owner_name: string | null;
  updated_at: string;
}

/**
 * The writable surface of a deliverable. type, title, and study_id are
 * identity, not status — a different deliverable is a new row (ADR-0006).
 */
export interface DeliverablePatch {
  status?: DeliverableStatus;
  approved_date?: string | null;
  etmf_uri?: string | null;
  owner_id?: string | null;
  version?: string | null;
}

export class DeliverableError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export async function listDeliverables(sql: Sql, studyId: string): Promise<DeliverableRow[]> {
  const rows = await sql`
    SELECT d.id, d.study_id, d.type, d.title, d.version, d.status,
           d.approved_date, d.etmf_uri, d.owner_id, p.name AS owner_name, d.updated_at
    FROM deliverable d
    LEFT JOIN person p ON p.id = d.owner_id
    WHERE d.study_id = ${studyId}
    ORDER BY d.type, d.title`;
  return rows as unknown as DeliverableRow[];
}

export async function updateDeliverable(
  sql: Sql,
  actor: Actor,
  input: { studyId: string; deliverableId: string; patch: DeliverablePatch },
): Promise<DeliverableRow> {
  const { studyId, deliverableId, patch } = input;
  const allowed = new Set(["status", "approved_date", "etmf_uri", "owner_id", "version"]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) {
      throw new DeliverableError(
        "invalid",
        `field '${key}' is not writable through this operation`,
      );
    }
  }
  if (Object.keys(patch).length === 0) {
    throw new DeliverableError("invalid", "empty patch");
  }

  return withActor(sql, actor, async (tx) => {
    const [current] = await tx`
      SELECT approved_date FROM deliverable
      WHERE id = ${deliverableId} AND study_id = ${studyId}
      FOR UPDATE`;
    if (!current) {
      throw new DeliverableError("not_found", "deliverable not found on this study");
    }
    // Approvals are dated facts mirroring the eTMF record, not the click
    // (ADR-0006): moving to approved requires a date, given or already set.
    const approvedDate =
      "approved_date" in patch ? patch.approved_date : (current.approved_date as string | null);
    if (patch.status === "approved" && !approvedDate) {
      throw new DeliverableError(
        "invalid",
        "an approved deliverable requires an approved_date (the date on the eTMF record)",
      );
    }
    await tx`
      UPDATE deliverable
      SET ${tx(patch as Record<string, string | null>)}, updated_at = now()
      WHERE id = ${deliverableId} AND study_id = ${studyId}`;
    const [row] = await tx`
      SELECT d.id, d.study_id, d.type, d.title, d.version, d.status,
             d.approved_date, d.etmf_uri, d.owner_id, p.name AS owner_name, d.updated_at
      FROM deliverable d
      LEFT JOIN person p ON p.id = d.owner_id
      WHERE d.id = ${deliverableId}`;
    return row as unknown as DeliverableRow;
  });
}
