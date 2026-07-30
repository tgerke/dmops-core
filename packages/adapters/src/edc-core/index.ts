import {
  type AdapterCapabilities,
  type ExtractionResult,
  type FrameName,
  type QueryRow,
  type SourceAdapter,
  type SubjectRow,
  checksumFrames,
} from "@dmops/adapter-contract";
import { z } from "zod";

/**
 * Reference EDC adapter (ADR-0005): reads edc-core's documented API with a
 * study-scoped API key. Read-only; the key's service-account user is
 * permission-checked and audited on the EDC side.
 *
 * Capability posture (verified against edc-core's API, 2026-07):
 * - queries: native lifecycle timestamps (createdAt/closedAt), native
 *   origin/status; first_response_at DERIVED from the first thread message
 *   authored by someone other than the query opener.
 * - subjects: native status (edc-core's enum matches the contract);
 *   enrolled_date UNSUPPORTED (edc-core exposes record creation, not an
 *   enrollment date — we do not pass one off as the other).
 * - visits: UNSUPPORTED — visit dates are captured item values, not API
 *   fields; entry_lag is gated off for edc-core-sourced studies by design.
 * - pages: UNSUPPORTED in v1 (form-instance mapping is future work).
 */
const configSchema = z
  .object({
    baseUrl: z.string().url(),
    /** Name of the env var holding the study-scoped API key — env indirection,
     * so secrets never sit in study_source.config. */
    apiKeyEnv: z.string().min(1),
  })
  .strict();

// Shapes from edc-core listStudyQueries / subjects listing (the fields we read).
interface EdcQueryRow {
  id: string;
  origin: "manual" | "system";
  status: "open" | "answered" | "closed";
  openedBy: string;
  createdAt: string;
  closedAt: string | null;
  subjectKey: string;
  formOid: string;
  messages: { author: string; createdAt: string }[];
}

interface EdcSubjectRow {
  id: string;
  subjectKey: string;
  status: "screening" | "enrolled" | "screen_failed" | "completed" | "withdrawn";
  siteId: string;
}

export function createEdcCoreAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  async function get<T>(baseUrl: string, apiKey: string, path: string): Promise<T> {
    const res = await fetchImpl(new URL(path, baseUrl), {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`edc-core GET ${path} failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  return {
    id: "edc-core",

    capabilities(): AdapterCapabilities {
      return {
        adapter: "edc-core",
        frames: {
          queries: {
            supported: true,
            fields: {
              source_query_id: "native",
              site_key: "derived",
              subject_key: "native",
              form_key: "native",
              origin: "native",
              status: "native",
              opened_at: "native",
              first_response_at: "derived",
              closed_at: "native",
            },
            notes:
              "site_key derived via the subject's site; first_response_at derived from the " +
              "first thread message not authored by the query opener",
          },
          subjects: {
            supported: true,
            fields: {
              subject_key: "native",
              site_key: "native",
              status: "native",
              enrolled_date: "unsupported",
            },
            notes: "edc-core exposes record creation time, not an enrollment date",
          },
          visits: {
            supported: false,
            fields: {},
            notes: "visit dates are captured item values, not API fields",
          },
          pages: { supported: false, fields: {}, notes: "form-instance mapping is future work" },
        },
      };
    },

    async extract({ sourceStudyKey, frames, config }): Promise<ExtractionResult> {
      const { baseUrl, apiKeyEnv } = configSchema.parse(config);
      const apiKey = process.env[apiKeyEnv];
      if (!apiKey) {
        throw new Error(`edc-core adapter: env var ${apiKeyEnv} is not set (see .env.example)`);
      }

      const out: Partial<Record<FrameName, unknown[]>> = {};
      const rowCounts: Partial<Record<FrameName, number>> = {};

      const wantsQueries = frames.includes("queries");
      const wantsSubjects = frames.includes("subjects");
      const unsupported = frames.filter((f) => f !== "queries" && f !== "subjects");
      if (unsupported.length > 0) {
        throw new Error(
          `edc-core adapter cannot extract: ${unsupported.join(", ")} (declared unsupported)`,
        );
      }

      // Subject → site mapping backs both the subjects frame and query site_key.
      const subjects =
        wantsQueries || wantsSubjects
          ? await get<EdcSubjectRow[]>(baseUrl, apiKey, `studies/${sourceStudyKey}/subjects`)
          : [];
      const siteBySubject = new Map(subjects.map((s) => [s.subjectKey, s.siteId]));

      if (wantsSubjects) {
        const rows: SubjectRow[] = subjects.map((s) => ({
          subject_key: s.subjectKey,
          site_key: s.siteId,
          status: s.status,
          enrolled_date: null,
        }));
        out.subjects = rows;
        rowCounts.subjects = rows.length;
      }

      if (wantsQueries) {
        const raw = await get<EdcQueryRow[]>(baseUrl, apiKey, `studies/${sourceStudyKey}/queries`);
        const rows: QueryRow[] = raw.map((q) => {
          const firstResponse = q.messages.find((m) => m.author !== q.openedBy);
          return {
            source_query_id: q.id,
            site_key: siteBySubject.get(q.subjectKey) ?? null,
            subject_key: q.subjectKey,
            form_key: q.formOid,
            origin: q.origin,
            status: q.status,
            opened_at: q.createdAt,
            first_response_at: firstResponse?.createdAt ?? null,
            closed_at: q.closedAt,
          };
        });
        out.queries = rows;
        rowCounts.queries = rows.length;
      }

      return {
        extracted_at: new Date().toISOString(),
        frames: out,
        row_counts: rowCounts,
        checksum: checksumFrames(out as Record<string, unknown[]>),
      };
    },
  };
}

export const edcCoreAdapter = createEdcCoreAdapter();
