import {
  type AdapterCapabilities,
  type ExtractionResult,
  type FrameName,
  type SourceAdapter,
  type TrainingRecordRow,
  checksumFrames,
} from "@dmops/adapter-contract";
import { z } from "zod";

/**
 * Veeva Vault Training adapter (ADR-0020): reads the training transcript —
 * the training_records frame and nothing else — through the public Vault
 * Platform API. Read-only, like every adapter (ADR-0005).
 *
 * Evidence base (tiers per ADR-0017), all accessed 2026-08-03:
 *
 * - Auth: POST /api/{version}/auth, form-encoded username/password, returns
 *   sessionId; presented on later calls in the Authorization header —
 *   https://developer.veevavault.com/api/25.1/#authentication [P].
 * - VQL: POST /api/{version}/query with the query as the q form parameter;
 *   response carries responseStatus, data, and responseDetails with a
 *   next_page pagination URL — the same reference, VQL section [P].
 *   Relationship traversal via __vr dot notation and column aliases (AS)
 *   per https://developer.veevavault.com/vql/ [P]; every relationship
 *   selection here is aliased so rows come back under flat, known keys.
 * - training_assignment__v fields: due_date__v, assigned_date__v,
 *   completion_date__v, state__v, learner__v, training_requirement__v per
 *   Veeva's vendor-hosted Vault Training help — Importing Training
 *   Assignments (quality.veevavault.help/en/lr/456120/), Training
 *   Recurrence (quality.veevavault.help/en/lr/4788081/) [P].
 * - expires_date DERIVED, constantly null: Vault Training has no expiry on
 *   a completion — recurrence reissues training as a NEW assignment with
 *   its own due date (Training Recurrence help [P]), so null is the true
 *   value under the source's model, not a withheld one (ADR-0020). The
 *   next obligation surfaces as a new row whose due_date restarts the
 *   clock.
 * - state__v vocabulary [NC]: help names lifecycle states in prose
 *   (Created, Assigned, Cancelled, Completed, Pending Substitute
 *   Completion, optional Resolved — Training Automation,
 *   quality.veevavault.help/en/gr/50967/) but does not enumerate the API
 *   values, and lifecycles are tenant-configurable. config.stateMap maps
 *   observed values to required|excluded; an unmapped value fails the
 *   extraction with the observed value in the message (ADR-0017).
 * - Learner email [NC]: a Training Assignment's Learner is a Person record
 *   referencing a unique User (Training Automation help [P]), but the
 *   Person object's field API names are not publicly enumerated.
 *   config.learnerEmailPath carries the VQL relationship path to the email
 *   (e.g. learner__vr.email__sys), verified per tenant against the
 *   documented object metadata API; a row whose path yields no email fails
 *   the extraction. person_key is that email, the mirrors' join key
 *   (ADR-0013).
 * - Date semantics [NC]: the help does not declare whether due/completion
 *   dates carry time or timezone; this adapter takes the leading date part
 *   and fails loudly on a value that does not start with an ISO date.
 *
 * access_grants is deliberately undeclared: Vault's user administration
 * governs access to Vault, not to the system under access review — the
 * access mirror keeps coming from the source that holds the grants
 * (ADR-0020).
 */
const API_VERSION = "v25.1"; // the reference version consulted (header)

// A VQL field path: identifiers joined by dots, nothing else — keeps
// config-supplied paths from smuggling VQL into the SELECT clause.
const vqlPath = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/i;

const configSchema = z
  .object({
    /** https://{vaultDNS} — tenant-specific, so required. */
    baseUrl: z.string().url(),
    /** Env indirection — secrets never sit in study_source.config. */
    usernameEnv: z.string().min(1),
    passwordEnv: z.string().min(1),
    /** Relationship path from training_assignment__v to the learner's
     * email, e.g. "learner__vr.email__sys" — tenant-verified (ADR-0020). */
    learnerEmailPath: z
      .string()
      .regex(vqlPath)
      .refine((p) => p.includes("."), {
        message: "must traverse a relationship (e.g. learner__vr.email__sys)",
      }),
    /** Optional path to the learner's display name. */
    learnerNamePath: z.string().regex(vqlPath).optional(),
    /** Assignment field carrying the study for a Study Training vault;
     * omitted, the whole vault's transcript is the study's transcript. */
    studyField: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/i)
      .optional(),
    /** Observed state__v value → required | excluded. Tenant lifecycles
     * are not publicly enumerable; unmapped values fail loudly (ADR-0020). */
    stateMap: z.record(z.enum(["required", "excluded"])),
  })
  .strict();

interface VaultAuthResponse {
  responseStatus: string;
  sessionId?: string;
  errors?: { type: string; message: string }[];
}

interface VaultQueryResponse {
  responseStatus: string;
  errors?: { type: string; message: string }[];
  responseDetails?: { next_page?: string };
  data?: Record<string, unknown>[];
}

const VAULT_FRAMES: FrameName[] = ["training_records"];

/** Leading ISO date part; fails loudly on anything else (see header). */
function datePart(value: unknown, field: string, assignment: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  throw new Error(
    `vault-training adapter: ${field} '${String(value)}' on assignment '${assignment}' is not an ISO date — refusing to guess the tenant's date format (ADR-0017)`,
  );
}

export function createVaultTrainingAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  function env(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`vault-training adapter: env var ${name} is not set (see .env.example)`);
    }
    return value;
  }

  async function authenticate(baseUrl: string, usernameEnv: string, passwordEnv: string) {
    const res = await fetchImpl(new URL(`api/${API_VERSION}/auth`, baseUrl), {
      method: "POST",
      body: new URLSearchParams({ username: env(usernameEnv), password: env(passwordEnv) }),
    });
    if (!res.ok) {
      throw new Error(`vault-training POST auth failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as VaultAuthResponse;
    if (body.responseStatus !== "SUCCESS" || !body.sessionId) {
      const detail = body.errors?.map((e) => `${e.type}: ${e.message}`).join("; ");
      throw new Error(`vault-training auth was not successful: ${detail ?? body.responseStatus}`);
    }
    return body.sessionId;
  }

  /** Run a VQL query, following next_page until the result set is whole. */
  async function query(
    baseUrl: string,
    sessionId: string,
    q: string,
  ): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    let res = await fetchImpl(new URL(`api/${API_VERSION}/query`, baseUrl), {
      method: "POST",
      headers: { authorization: sessionId, accept: "application/json" },
      body: new URLSearchParams({ q }),
    });
    for (;;) {
      if (!res.ok) {
        throw new Error(`vault-training query failed: ${res.status} ${res.statusText}`);
      }
      const body = (await res.json()) as VaultQueryResponse;
      if (body.responseStatus !== "SUCCESS") {
        const detail = body.errors?.map((e) => `${e.type}: ${e.message}`).join("; ");
        throw new Error(
          `vault-training query was not successful: ${detail ?? body.responseStatus}`,
        );
      }
      rows.push(...(body.data ?? []));
      const next = body.responseDetails?.next_page;
      if (!next) return rows;
      res = await fetchImpl(new URL(next, baseUrl), {
        headers: { authorization: sessionId, accept: "application/json" },
      });
    }
  }

  return {
    id: "vault-training",

    capabilities(): AdapterCapabilities {
      // Only the transcript: access_grants stays undeclared on purpose —
      // Vault administers access to Vault, not to the system under access
      // review (ADR-0020). Fail-closed covers the rest (ADR-0005).
      return {
        adapter: "vault-training",
        frames: {
          training_records: {
            supported: true,
            fields: {
              person_key: "derived",
              person_name: "derived",
              course_key: "native",
              course_title: "native",
              due_date: "native",
              completed_date: "native",
              expires_date: "derived",
            },
            notes:
              "person_key/person_name read through config-named relationship paths " +
              "(Person field names are tenant-specific — ADR-0020); expires_date is " +
              "constantly null because Vault Training reissues recurring training as a " +
              "new assignment instead of expiring the completion, so the next obligation " +
              "arrives as a new row with its own due date",
          },
        },
      };
    },

    async extract({ sourceStudyKey, frames, config }): Promise<ExtractionResult> {
      const parsed = configSchema.parse(config);
      const unsupported = frames.filter((f) => !VAULT_FRAMES.includes(f));
      if (unsupported.length > 0) {
        throw new Error(
          `vault-training adapter cannot extract: ${unsupported.join(", ")} (declared unsupported)`,
        );
      }
      // VQL string-literal escaping is not publicly specified; refuse keys
      // that would need it rather than guess (ADR-0017).
      if (sourceStudyKey.includes("'")) {
        throw new Error(
          `vault-training adapter: source_study_key '${sourceStudyKey}' contains a quote, which the adapter refuses to escape into VQL`,
        );
      }

      const sessionId = await authenticate(parsed.baseUrl, parsed.usernameEnv, parsed.passwordEnv);

      const select = [
        "id",
        "state__v",
        "due_date__v",
        "completion_date__v",
        "training_requirement__v",
        "training_requirement__vr.name__v AS course_title",
        `${parsed.learnerEmailPath} AS person_email`,
      ];
      if (parsed.learnerNamePath) select.push(`${parsed.learnerNamePath} AS person_name`);
      const where = parsed.studyField ? ` WHERE ${parsed.studyField} = '${sourceStudyKey}'` : "";
      const raw = await query(
        parsed.baseUrl,
        sessionId,
        `SELECT ${select.join(", ")} FROM training_assignment__v${where}`,
      );

      const rows: TrainingRecordRow[] = [];
      for (const r of raw) {
        const id = String(r.id ?? "(no id)");
        const state = String(r.state__v ?? "");
        const posture = parsed.stateMap[state];
        if (!posture) {
          throw new Error(
            `vault-training adapter: lifecycle state '${state}' on assignment '${id}' has no stateMap entry in study_source.config — Vault lifecycles are tenant-configured and must be mapped explicitly (ADR-0020)`,
          );
        }
        if (posture === "excluded") continue; // a withdrawn requirement is not a gap
        const email = r.person_email;
        if (typeof email !== "string" || email.length === 0) {
          throw new Error(
            `vault-training adapter: learnerEmailPath '${parsed.learnerEmailPath}' yielded no email for assignment '${id}' — verify the path against the tenant's object metadata (ADR-0020)`,
          );
        }
        const courseKey = r.training_requirement__v;
        if (typeof courseKey !== "string" || courseKey.length === 0) {
          throw new Error(
            `vault-training adapter: assignment '${id}' carries no training_requirement__v reference`,
          );
        }
        rows.push({
          person_key: email,
          person_name: typeof r.person_name === "string" && r.person_name ? r.person_name : null,
          course_key: courseKey,
          course_title:
            typeof r.course_title === "string" && r.course_title ? r.course_title : null,
          due_date: datePart(r.due_date__v, "due_date__v", id),
          completed_date: datePart(r.completion_date__v, "completion_date__v", id),
          expires_date: null, // derived: recurrence reissues, completions never expire
        });
      }

      const out: Partial<Record<FrameName, unknown[]>> = { training_records: rows };
      return {
        extracted_at: new Date().toISOString(),
        frames: out,
        row_counts: { training_records: rows.length },
        checksum: checksumFrames(out as Record<string, unknown[]>),
      };
    },
  };
}

export const vaultTrainingAdapter = createVaultTrainingAdapter();
