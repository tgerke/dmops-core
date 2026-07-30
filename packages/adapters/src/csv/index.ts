import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AdapterCapabilities,
  type ExtractionResult,
  type FrameName,
  type SourceAdapter,
  checksumFrames,
} from "@dmops/adapter-contract";
import { z } from "zod";

/**
 * The fixture adapter: reads a directory of CSV files — one per frame — and
 * declares everything native. This is the five-minute-demo path and the
 * reference implementation adapter authors copy (ADR-0005).
 *
 * CSV conventions: header row names the contract fields, empty cell = null,
 * `true`/`false` for booleans. Values must not contain commas — these are
 * fixtures, not a general CSV dialect.
 */
const configSchema = z.object({ dir: z.string().min(1) }).strict();

const BOOLEAN_FIELDS = new Set(["occurred"]);

function parseCsv(raw: string): Record<string, string | boolean | null>[] {
  const lines = raw.trim().split("\n");
  const header = lines[0]?.split(",").map((h) => h.trim()) ?? [];
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    return Object.fromEntries(
      header.map((field, i) => {
        const cell = cells[i] ?? "";
        if (cell === "") return [field, null];
        if (BOOLEAN_FIELDS.has(field)) return [field, cell === "true"];
        return [field, cell];
      }),
    );
  });
}

function repoRoot(): string {
  return fileURLToPath(new URL("../../../..", import.meta.url));
}

export const csvAdapter: SourceAdapter = {
  id: "csv",

  capabilities(): AdapterCapabilities {
    const allNative = (fields: string[]) => ({
      supported: true,
      fields: Object.fromEntries(fields.map((f) => [f, "native" as const])),
    });
    return {
      adapter: "csv",
      frames: {
        queries: allNative([
          "source_query_id",
          "site_key",
          "subject_key",
          "form_key",
          "origin",
          "status",
          "opened_at",
          "first_response_at",
          "closed_at",
        ]),
        subjects: allNative(["subject_key", "site_key", "status", "enrolled_date"]),
        visits: allNative(["subject_key", "visit_key", "visit_date", "occurred"]),
        pages: allNative([
          "subject_key",
          "visit_key",
          "form_key",
          "status",
          "first_entered_at",
          "sdv_status",
        ]),
        issues: allNative(["source_issue_id", "repo_key", "state", "opened_at", "closed_at"]),
        pull_requests: allNative([
          "source_pr_id",
          "repo_key",
          "state",
          "opened_at",
          "merged_at",
          "closed_at",
        ]),
        reviews: allNative([
          "source_review_id",
          "source_pr_id",
          "repo_key",
          "reviewer_key",
          "state",
          "submitted_at",
        ]),
        training_records: allNative([
          "person_key",
          "person_name",
          "course_key",
          "course_title",
          "due_date",
          "completed_date",
          "expires_date",
        ]),
        access_grants: allNative([
          "person_key",
          "person_name",
          "role_key",
          "site_key",
          "status",
          "granted_at",
        ]),
      },
    };
  },

  async extract({ frames, config }): Promise<ExtractionResult> {
    const { dir } = configSchema.parse(config);
    const base = isAbsolute(dir) ? dir : join(repoRoot(), dir);
    const out: Partial<Record<FrameName, unknown[]>> = {};
    const rowCounts: Partial<Record<FrameName, number>> = {};
    for (const frame of frames) {
      const rows = parseCsv(readFileSync(join(base, `${frame}.csv`), "utf8"));
      out[frame] = rows;
      rowCounts[frame] = rows.length;
    }
    return {
      extracted_at: new Date().toISOString(),
      frames: out,
      row_counts: rowCounts,
      checksum: checksumFrames(out as Record<string, unknown[]>),
    };
  },
};
