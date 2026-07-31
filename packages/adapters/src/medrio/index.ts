import {
  type AdapterCapabilities,
  type ExtractionResult,
  type FrameName,
  type PageRow,
  type SourceAdapter,
  type SubjectRow,
  type VisitRow,
  checksumFrames,
} from "@dmops/adapter-contract";
import { z } from "zod";

/**
 * Medrio adapter (ADR-0017): reads the Medrio Connect API. Read-only, like
 * every adapter (ADR-0005).
 *
 * Evidence base (tiers per ADR-0017): the only public Medrio API
 * documentation is the OpenAPI document itself —
 * https://connectapi.medrio.com/swagger/v1/swagger.json, info.title
 * "Medrio OpenApi v.42.14.0.201", fetched 2026-07-31 [P]. Medrio's prose
 * documentation (community.medrio.com) is login-gated [NC]. Every claim
 * below is [P] against that spec unless marked otherwise.
 *
 * - queries: UNSUPPORTED. The spec exposes no query/discrepancy/edit-check
 *   surface of any kind (exhaustive keyword search of the document). A
 *   Medrio-sourced study therefore computes no query metrics, and the API
 *   reports them unavailable with the named gaps — the correct outcome
 *   (DM-P1, ADR-0005), not a defect.
 * - subjects: GET /api/study/{studyId}/subject returns subjectIdentifier,
 *   siteId, statusName, enrollmentDate (and PII fields this adapter never
 *   reads). site_key DERIVED via GET /api/study/{studyId}/site
 *   (siteId → siteNumber). status DERIVED through config.statusMap because
 *   Medrio subject statuses are a study-configured dictionary
 *   (GET /api/study/{studyId}/subjectStatus), not a fixed vocabulary — an
 *   unmapped statusName fails the extraction with the observed value.
 *   enrolled_date DERIVED as the date part of enrollmentDate (a date-time
 *   whose timezone semantics the spec does not declare [NC]).
 * - visits: GET /api/study/{studyId}/subject/{subjectId}/visit (per-subject
 *   only; the spec has no study-level visit listing). Rows arrive one per
 *   (visit instance × form); this adapter dedupes to visit instances.
 *   visit_key DERIVED (visitName + visitSequenceNumber); occurred DERIVED
 *   (any form of the instance has dataEntered). visit_date UNSUPPORTED —
 *   no response schema carries a visit date; in Medrio the visit date is a
 *   study-specific CRF variable, and a per-study CRF mapping (ADR-0018)
 *   cannot be implemented either: the spec's only dataentry surfaces are
 *   write-only (POST /api/study/{studyId}/dataentry and the per-form
 *   variant) and no endpoint returns entered values [P] (re-verified
 *   2026-07-31), so the deferral is closed as not publicly implementable.
 * - pages: same response, one row per collection point. status DERIVED
 *   conservatively: locked → locked, dataEntered → in_progress (the API's
 *   booleans cannot distinguish complete from partial entry, so this
 *   adapter never claims complete), else not_started. first_entered_at
 *   UNSUPPORTED — no entry timestamp exists anywhere in the spec.
 *   sdv_status UNSUPPORTED — isMonitored is a monitoring flag whose
 *   equivalence to SDV is not documented [NC]; never verified-by-optimism.
 *
 * Auth: POST /Oauth/token (exact casing per the spec) with form-encoded
 * UserName/Password/GrantType/CustomerApiKey. The spec declares no
 * securitySchemes and no servers [P]; presenting the returned accessToken
 * as an Authorization bearer header is the conventional reading of
 * tokenType, not a documented contract [NC], and baseUrl is therefore
 * required config rather than a default. GrantType value "password" is
 * likewise conventional [NC]. Every /api response is wrapped in the spec's
 * ...EventResultWithResponse envelope (processedSuccessfully,
 * processMessage, response); this adapter unwraps and checks it per call.
 *
 * The spec declares no pagination and no since/modified filters on any
 * endpoint [P]: extraction is a full refresh of 1 + 1 + n_subjects calls.
 */
const subjectStatuses = [
  "screening",
  "enrolled",
  "completed",
  "withdrawn",
  "screen_failed",
] as const;

const configSchema = z
  .object({
    /** Required: the spec declares no servers entry (see header). */
    baseUrl: z.string().url(),
    /** Env indirection — secrets never sit in study_source.config. */
    usernameEnv: z.string().min(1),
    passwordEnv: z.string().min(1),
    customerApiKeyEnv: z.string().min(1),
    /** Medrio statusName → contract subject status. Study-configured on the
     * Medrio side, so it must be mapped explicitly per study (ADR-0017). */
    statusMap: z.record(z.enum(subjectStatuses)),
  })
  .strict();

// Response shapes we read (fields per the OpenAPI document in the header).
interface MedrioEnvelope<T> {
  processedSuccessfully: boolean;
  processMessage: string | null;
  response: T;
}

interface MedrioOAuthResponse {
  accessToken: string;
}

interface MedrioSite {
  siteId: string;
  siteNumber: string | null;
}

// The subject response also carries PII (firstName, lastName, dateOfBirth);
// this adapter deliberately never reads those fields.
interface MedrioSubject {
  subjectId: string;
  subjectIdentifier: string;
  siteId: string | null;
  statusName: string;
  enrollmentDate: string | null;
}

interface MedrioSubjectVisit {
  collectionPointId: string;
  visitName: string;
  visitSequenceNumber: number;
  formName: string;
  dataEntered: boolean;
  locked: boolean;
}

const MEDRIO_FRAMES: FrameName[] = ["subjects", "visits", "pages"];

/** One visit instance per (visitName, visitSequenceNumber) — see header. */
function visitKey(v: MedrioSubjectVisit): string {
  return `${v.visitName}#${v.visitSequenceNumber}`;
}

export function createMedrioAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  async function token(
    baseUrl: string,
    config: {
      usernameEnv: string;
      passwordEnv: string;
      customerApiKeyEnv: string;
    },
  ): Promise<string> {
    const env = (name: string): string => {
      const value = process.env[name];
      if (!value) {
        throw new Error(`medrio adapter: env var ${name} is not set (see .env.example)`);
      }
      return value;
    };
    const body = new URLSearchParams({
      UserName: env(config.usernameEnv),
      Password: env(config.passwordEnv),
      GrantType: "password",
      CustomerApiKey: env(config.customerApiKeyEnv),
    });
    const res = await fetchImpl(new URL("Oauth/token", baseUrl), { method: "POST", body });
    if (!res.ok) {
      throw new Error(`medrio POST Oauth/token failed: ${res.status} ${res.statusText}`);
    }
    return ((await res.json()) as MedrioOAuthResponse).accessToken;
  }

  async function get<T>(baseUrl: string, accessToken: string, path: string): Promise<T> {
    const res = await fetchImpl(new URL(path, baseUrl), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`medrio GET ${path} failed: ${res.status} ${res.statusText}`);
    }
    const envelope = (await res.json()) as MedrioEnvelope<T>;
    if (!envelope.processedSuccessfully) {
      throw new Error(`medrio GET ${path} was not processed: ${envelope.processMessage}`);
    }
    return envelope.response;
  }

  return {
    id: "medrio",

    capabilities(): AdapterCapabilities {
      // access_grants/training_records undeclared: the spec has user
      // endpoints, but mirror semantics are unverified — fail-closed.
      return {
        adapter: "medrio",
        frames: {
          queries: {
            supported: false,
            fields: {},
            notes:
              "no query/discrepancy surface exists in the public Medrio Connect API " +
              "(Medrio OpenApi v.42.14.0.201, fetched 2026-07-31; ADR-0017)",
          },
          subjects: {
            supported: true,
            fields: {
              subject_key: "native",
              site_key: "derived",
              status: "derived",
              enrolled_date: "derived",
            },
            notes:
              "site_key derived via the site listing (siteId → siteNumber); status derived " +
              "through config.statusMap (Medrio statuses are study-configured — unmapped " +
              "values fail the extraction); enrolled_date is the date part of a date-time " +
              "with undeclared timezone semantics",
          },
          visits: {
            supported: true,
            fields: {
              subject_key: "native",
              visit_key: "derived",
              occurred: "derived",
              visit_date: "unsupported",
            },
            notes:
              "visit_key derived as visitName#visitSequenceNumber; occurred derived from " +
              "dataEntered on any form of the instance; the API exposes no visit date — " +
              "in Medrio it is a study-specific CRF variable, and the spec has no surface " +
              "that reads entered values, so no CRF mapping can derive it (ADR-0018)",
          },
          pages: {
            supported: true,
            fields: {
              subject_key: "native",
              visit_key: "derived",
              form_key: "native",
              status: "derived",
              first_entered_at: "unsupported",
              sdv_status: "unsupported",
            },
            notes:
              "status derived conservatively from dataEntered/locked booleans (never claims " +
              "complete); the API exposes no entry timestamps; isMonitored's equivalence to " +
              "SDV is undocumented, so sdv_status is not asserted",
          },
        },
      };
    },

    async extract({ sourceStudyKey, frames, config }): Promise<ExtractionResult> {
      const parsed = configSchema.parse(config);
      const unsupported = frames.filter((f) => !MEDRIO_FRAMES.includes(f));
      if (unsupported.length > 0) {
        throw new Error(
          `medrio adapter cannot extract: ${unsupported.join(", ")} (declared unsupported)`,
        );
      }

      const accessToken = await token(parsed.baseUrl, parsed);
      const out: Partial<Record<FrameName, unknown[]>> = {};
      const rowCounts: Partial<Record<FrameName, number>> = {};

      // Every frame starts from the subject listing (visits are per-subject).
      const subjects = await get<MedrioSubject[]>(
        parsed.baseUrl,
        accessToken,
        `api/study/${sourceStudyKey}/subject`,
      );

      if (frames.includes("subjects")) {
        const sites = await get<MedrioSite[]>(
          parsed.baseUrl,
          accessToken,
          `api/study/${sourceStudyKey}/site`,
        );
        const siteNumberById = new Map(sites.map((s) => [s.siteId, s.siteNumber]));
        const rows: SubjectRow[] = subjects.map((s) => {
          const status = parsed.statusMap[s.statusName];
          if (!status) {
            throw new Error(
              `medrio adapter: subject status '${s.statusName}' has no statusMap entry in study_source.config — Medrio statuses are study-configured and must be mapped explicitly (ADR-0017)`,
            );
          }
          return {
            subject_key: s.subjectIdentifier,
            site_key: (s.siteId && siteNumberById.get(s.siteId)) || null,
            status,
            enrolled_date: s.enrollmentDate?.slice(0, 10) ?? null,
          };
        });
        out.subjects = rows;
        rowCounts.subjects = rows.length;
      }

      if (frames.includes("visits") || frames.includes("pages")) {
        const visitRows: VisitRow[] = [];
        const pageRows: PageRow[] = [];
        for (const s of subjects) {
          const collection = await get<MedrioSubjectVisit[]>(
            parsed.baseUrl,
            accessToken,
            `api/study/${sourceStudyKey}/subject/${s.subjectId}/visit`,
          );
          const entered = new Map<string, boolean>();
          for (const v of collection) {
            entered.set(visitKey(v), (entered.get(visitKey(v)) ?? false) || v.dataEntered);
          }
          if (frames.includes("visits")) {
            for (const [key, occurred] of entered) {
              visitRows.push({
                subject_key: s.subjectIdentifier,
                visit_key: key,
                visit_date: null, // unsupported: no visit date exists in the API
                occurred,
              });
            }
          }
          if (frames.includes("pages")) {
            for (const v of collection) {
              pageRows.push({
                subject_key: s.subjectIdentifier,
                visit_key: visitKey(v),
                form_key: v.formName,
                // Booleans cannot distinguish complete from partial entry;
                // never claim complete (DM-P1).
                status: v.locked ? "locked" : v.dataEntered ? "in_progress" : "not_started",
                first_entered_at: null, // unsupported: no entry timestamp in the API
                sdv_status: null, // unsupported: isMonitored ≠ documented SDV
              });
            }
          }
        }
        if (frames.includes("visits")) {
          out.visits = visitRows;
          rowCounts.visits = visitRows.length;
        }
        if (frames.includes("pages")) {
          out.pages = pageRows;
          rowCounts.pages = pageRows.length;
        }
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

export const medrioAdapter = createMedrioAdapter();
