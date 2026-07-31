import {
  type AdapterCapabilities,
  type ExtractionResult,
  type FrameName,
  type PageRow,
  type QueryRow,
  type SourceAdapter,
  type SubjectRow,
  type VisitRow,
  checksumFrames,
} from "@dmops/adapter-contract";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

/**
 * Medidata Rave adapter (ADR-0017): reads Rave Web Services (RWS).
 * Read-only, like every adapter (ADR-0005).
 *
 * Evidence base (tiers per ADR-0017). Medidata's public RWS WebHelp
 * (rws-webhelp.s3.amazonaws.com, titled "Rave Web Services (RWS) 2014.2.0
 * documentation" in search indexes) returned HTTP 403 AccessDenied on
 * 2026-07-31, and learn.medidata.com is login-gated. Every claim below is
 * therefore [V-OSS]: verified against Medidata's own open-source RWS client
 * rwslib — docs "rwslib 1.2.15" (rwslib.readthedocs.io, consulted
 * 2026-07-31), source github.com/mdsol/rwslib @ master (same date:
 * rws_requests/__init__.py, rws_requests/odm_adapter.py,
 * extras/audit_event/parser.py, extras/audit_event/context.py) — and, for
 * audit subcategories, Medidata's techblog post "Reading audit events"
 * (techblog.mdsol.com, 2014-12-23). A deployment with Medidata support
 * access should re-verify [NC] items before production use.
 *
 * - Auth: HTTP Basic with a Rave username/password [V-OSS]. MAuth (App
 *   UUID + private key) exists and is preferred by Medidata for long-term
 *   integrations [V-OSS]; it is a named deferral here.
 * - queries: RWS has no dedicated queries dataset in any publicly
 *   documented surface; query data rides the audit trail. This adapter
 *   reads GET /RaveWebServices/datasets/ClinicalAuditRecords.odm
 *   ?studyoid={Project(Env)}&startid={n}&per_page={n} [V-OSS], following
 *   the response Link header rel="next" cursor to exhaustion (described in
 *   prose by Medidata as reading the audit trail "as a kind of tape"; the
 *   exact header syntax is not publicly quoted [NC], so the adapter reads
 *   a standard RFC 8288 rel="next" link and stops when absent). Each audit
 *   event is a ClinicalData element (mdsol:AuditSubCategoryName) wrapping
 *   SubjectData/StudyEventData/FormData/ItemGroupData/ItemData with an
 *   AuditRecord (UserRef, LocationRef, DateTimeStamp, SourceID) and, for
 *   query events, an mdsol:Query element carrying QueryRepeatKey, Status,
 *   Response, Recipient, Value — element and attribute names exactly per
 *   rwslib's audit parser [V-OSS]. Query lifecycle timestamps are DERIVED
 *   by replaying status transitions per query identity; the Status
 *   vocabulary is NOT publicly enumerated [NC], so values outside a
 *   conservative open/answered/closed/cancelled canonicalization fail the
 *   extraction with the observed value (ADR-0017). origin UNSUPPORTED
 *   (manual-vs-system attribution is not publicly confirmable).
 * - subjects: GET /RaveWebServices/studies/{Project(Env)}/subjects
 *   ?status=true&subjectKeyType=SubjectName [V-OSS]; the documented sample
 *   response carries SubjectData@SubjectKey with SiteRef@LocationOID
 *   [V-OSS]. The attribute carrying workflow status in THIS response is
 *   not shown in public samples [NC]; the adapter reads mdsol:Status (the
 *   attribute rwslib's audit parser reads on SubjectData) and maps it
 *   through config.statusMap — a subject with no readable status, or an
 *   unmapped value, fails the extraction with the subject named.
 *   enrolled_date UNSUPPORTED (no documented field; the SubjectCreated
 *   audit timestamp is a possible future derivation, noted not asserted).
 * - visits: DERIVED from the audit tape — an event instance
 *   (StudyEventOID + StudyEventRepeatKey) is emitted with occurred=true
 *   when entered data references it ("Entered" subcategory, per the
 *   techblog [V-OSS]); scheduled-but-unvisited instances are not observable
 *   here, and visit_date is UNSUPPORTED — no publicly documented RWS field
 *   carries it; in Rave it is a study-specific CRF item (named deferral).
 * - pages: DERIVED from the audit tape per (subject, event instance,
 *   FormOID): first_entered_at is the earliest "Entered" DateTimeStamp.
 *   status is DERIVED conservatively as in_progress once entered — a
 *   page-level completeness/lock rollup is not publicly documented, and
 *   the item-level mdsol:Freeze/Verify/Lock flags observed on audit
 *   events cover only audited items, so no stronger claim is honest.
 *   sdv_status UNSUPPORTED for the same reason (item-level Verify exists;
 *   page-level SDV rollup does not, publicly).
 *
 * Rate limits and DateTimeStamp precision/timezone are not publicly
 * documented [NC]: a DateTimeStamp with no explicit offset is stamped Z to
 * satisfy the contract's ISO 8601 requirement — an assumption, declared
 * here and carried by the affected fields' derived posture, to be verified
 * against a live tenant. Clinical View datasets (a second extraction
 * subsystem with its own start/X-MWS-CV-Last-Updated watermark semantics)
 * are not used by this adapter.
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
    /** The deployment's Rave host, e.g. https://{subdomain}.mdsol.com */
    baseUrl: z.string().url(),
    /** Env indirection — secrets never sit in study_source.config. */
    usernameEnv: z.string().min(1),
    passwordEnv: z.string().min(1),
    /** Rave subject workflow status → contract status. Study-configured on
     * the Rave side, so it must be mapped explicitly per study (ADR-0017). */
    statusMap: z.record(z.enum(subjectStatuses)),
    auditPerPage: z.number().int().positive().default(100),
  })
  .strict();

const RAVE_FRAMES: FrameName[] = ["queries", "subjects", "visits", "pages"];

/** Contract query status from an observed mdsol:Query Status value. The
 * vocabulary is not publicly enumerated [NC]: anything outside this
 * conservative canonicalization fails loudly (ADR-0017). */
function canonicalQueryStatus(observed: string): QueryRow["status"] {
  const s = observed.toLowerCase();
  if (s === "open") return "open";
  if (s === "answered") return "answered";
  if (s === "closed") return "closed";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  throw new Error(
    `rave adapter: unrecognized query status '${observed}' — the RWS query status vocabulary is not publicly enumerated; extend the adapter's canonicalization against vendor documentation, never by guess (ADR-0017)`,
  );
}

// XML node access helpers: fast-xml-parser output with attribute prefix "@_"
// and namespace prefixes kept literal (mdsol:).
type XmlNode = Record<string, unknown>;

function attr(node: XmlNode, name: string): string | undefined {
  const value = node[`@_${name}`];
  return value === undefined ? undefined : String(value);
}

function children(node: XmlNode, name: string): XmlNode[] {
  const value = node[name];
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]) as XmlNode[];
}

function text(node: XmlNode, name: string): string | undefined {
  const value = node[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object") {
    const t = (value as XmlNode)["#text"];
    return t === undefined ? undefined : String(t);
  }
  return String(value);
}

/** One audit event flattened out of a ClinicalData element. */
interface AuditEvent {
  subcategory: string | undefined;
  subjectKey: string | undefined;
  subjectStatus: string | undefined;
  eventOid: string | undefined;
  eventRepeatKey: string | undefined;
  formOid: string | undefined;
  itemGroupOid: string | undefined;
  itemGroupRepeatKey: string | undefined;
  itemOid: string | undefined;
  locationOid: string | undefined;
  dateTimeStamp: string | undefined;
  query: { repeatKey: string | undefined; status: string | undefined } | undefined;
}

export function createRaveAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    // Repeatable ODM elements must stay arrays even when a page has one.
    isArray: (name) =>
      [
        "ClinicalData",
        "SubjectData",
        "StudyEventData",
        "FormData",
        "ItemGroupData",
        "ItemData",
        "mdsol:Query",
      ].includes(name),
  });

  async function get(url: URL, username: string, password: string): Promise<Response> {
    const res = await fetchImpl(url, {
      headers: {
        authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      },
    });
    if (!res.ok) {
      throw new Error(`rave GET ${url.pathname} failed: ${res.status} ${res.statusText}`);
    }
    return res;
  }

  /** Read the full audit tape, following the Link rel="next" cursor. */
  async function auditTape(
    baseUrl: string,
    studyOid: string,
    perPage: number,
    username: string,
    password: string,
  ): Promise<AuditEvent[]> {
    const first = new URL("RaveWebServices/datasets/ClinicalAuditRecords.odm", baseUrl);
    first.searchParams.set("studyoid", studyOid);
    first.searchParams.set("startid", "1");
    first.searchParams.set("per_page", String(perPage));

    const events: AuditEvent[] = [];
    let next: URL | null = first;
    while (next) {
      const res = await get(next, username, password);
      const odm = children(parser.parse(await res.text()) as XmlNode, "ODM")[0] ?? {};
      for (const clinical of children(odm, "ClinicalData")) {
        const subcategory = attr(clinical, "mdsol:AuditSubCategoryName");
        for (const subject of children(clinical, "SubjectData")) {
          // The AuditRecord sits on the entity it audits; search each level.
          const levels: XmlNode[] = [subject];
          const event = children(subject, "StudyEventData")[0];
          if (event) levels.push(event);
          const form = event ? children(event, "FormData")[0] : undefined;
          if (form) levels.push(form);
          const itemGroup = form ? children(form, "ItemGroupData")[0] : undefined;
          if (itemGroup) levels.push(itemGroup);
          const item = itemGroup ? children(itemGroup, "ItemData")[0] : undefined;
          if (item) levels.push(item);

          const auditRecord = levels
            .map((l) => children(l, "AuditRecord")[0])
            .find((a) => a !== undefined);
          const query = item ? children(item, "mdsol:Query")[0] : undefined;

          events.push({
            subcategory,
            subjectKey: subject
              ? (attr(subject, "mdsol:SubjectName") ?? attr(subject, "SubjectKey"))
              : undefined,
            subjectStatus: subject ? attr(subject, "mdsol:Status") : undefined,
            eventOid: event ? attr(event, "StudyEventOID") : undefined,
            eventRepeatKey: event ? attr(event, "StudyEventRepeatKey") : undefined,
            formOid: form ? attr(form, "FormOID") : undefined,
            itemGroupOid: itemGroup ? attr(itemGroup, "ItemGroupOID") : undefined,
            itemGroupRepeatKey: itemGroup ? attr(itemGroup, "ItemGroupRepeatKey") : undefined,
            itemOid: item ? attr(item, "ItemOID") : undefined,
            locationOid: auditRecord
              ? attr(children(auditRecord, "LocationRef")[0] ?? {}, "LocationOID")
              : undefined,
            dateTimeStamp: auditRecord ? text(auditRecord, "DateTimeStamp") : undefined,
            query: query
              ? { repeatKey: attr(query, "QueryRepeatKey"), status: attr(query, "Status") }
              : undefined,
          });
        }
      }
      const link = res.headers.get("link") ?? "";
      const nextHref = link.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      next = nextHref ? new URL(nextHref, baseUrl) : null;
    }
    return events;
  }

  /** Event-instance key: StudyEventOID plus repeat key when present. */
  function eventKey(e: AuditEvent): string {
    return e.eventRepeatKey ? `${e.eventOid}[${e.eventRepeatKey}]` : `${e.eventOid}`;
  }

  /** RWS timezone semantics are not publicly documented [NC]: an offset-less
   * DateTimeStamp is stamped Z, per the header's declared assumption. */
  function normalizeDateTime(value: string): string {
    return /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  }

  return {
    id: "rave",

    capabilities(): AdapterCapabilities {
      return {
        adapter: "rave",
        frames: {
          queries: {
            supported: true,
            fields: {
              source_query_id: "derived",
              site_key: "derived",
              subject_key: "native",
              form_key: "native",
              origin: "unsupported",
              status: "derived",
              opened_at: "derived",
              first_response_at: "derived",
              closed_at: "derived",
            },
            notes:
              "reconstructed by replaying mdsol:Query status transitions on the " +
              "ClinicalAuditRecords tape; the status vocabulary is not publicly enumerated — " +
              "unrecognized values fail the extraction (ADR-0017); site_key is the audit " +
              "LocationOID, which the operator aligns with site_number",
          },
          subjects: {
            supported: true,
            fields: {
              subject_key: "native",
              site_key: "native",
              status: "derived",
              enrolled_date: "unsupported",
            },
            notes:
              "site_key is SiteRef LocationOID per the documented sample response; status is " +
              "read from mdsol:Status (attribute name not publicly shown for this response) " +
              "and mapped through config.statusMap — missing or unmapped statuses fail the " +
              "extraction; no documented enrollment date field exists",
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
              "event instances observed with entered data on the audit tape; " +
              "scheduled-but-unvisited instances are not observable here; visit dates are " +
              "study-specific CRF items, not RWS fields (named deferral)",
          },
          pages: {
            supported: true,
            fields: {
              subject_key: "native",
              visit_key: "derived",
              form_key: "native",
              status: "derived",
              first_entered_at: "derived",
              sdv_status: "unsupported",
            },
            notes:
              "first_entered_at is the earliest 'Entered' audit timestamp per page; status " +
              "is conservatively in_progress once entered — a page-level completeness/lock " +
              "rollup is not publicly documented, and neither is a page-level SDV status",
          },
        },
      };
    },

    async extract({ sourceStudyKey, frames, config }): Promise<ExtractionResult> {
      const parsed = configSchema.parse(config);
      const env = (name: string): string => {
        const value = process.env[name];
        if (!value) {
          throw new Error(`rave adapter: env var ${name} is not set (see .env.example)`);
        }
        return value;
      };
      const username = env(parsed.usernameEnv);
      const password = env(parsed.passwordEnv);
      const unsupported = frames.filter((f) => !RAVE_FRAMES.includes(f));
      if (unsupported.length > 0) {
        throw new Error(
          `rave adapter cannot extract: ${unsupported.join(", ")} (declared unsupported)`,
        );
      }

      const out: Partial<Record<FrameName, unknown[]>> = {};
      const rowCounts: Partial<Record<FrameName, number>> = {};

      if (frames.includes("subjects")) {
        const url = new URL(
          `RaveWebServices/studies/${encodeURIComponent(sourceStudyKey)}/subjects`,
          parsed.baseUrl,
        );
        url.searchParams.set("status", "true");
        url.searchParams.set("subjectKeyType", "SubjectName");
        const res = await get(url, username, password);
        const odm = children(parser.parse(await res.text()) as XmlNode, "ODM")[0] ?? {};
        const rows: SubjectRow[] = [];
        for (const clinical of children(odm, "ClinicalData")) {
          for (const subject of children(clinical, "SubjectData")) {
            const subjectKey = attr(subject, "mdsol:SubjectName") ?? attr(subject, "SubjectKey");
            const observed = attr(subject, "mdsol:Status");
            if (!subjectKey) continue;
            if (!observed) {
              throw new Error(
                `rave adapter: subject '${subjectKey}' carries no readable workflow status (mdsol:Status) — the status attribute for this response is not publicly documented; verify against vendor documentation (ADR-0017)`,
              );
            }
            const status = parsed.statusMap[observed];
            if (!status) {
              throw new Error(
                `rave adapter: subject status '${observed}' has no statusMap entry in study_source.config — Rave workflow statuses are study-configured and must be mapped explicitly (ADR-0017)`,
              );
            }
            rows.push({
              subject_key: subjectKey,
              site_key: attr(children(subject, "SiteRef")[0] ?? {}, "LocationOID") ?? null,
              status,
              enrolled_date: null, // unsupported: no documented enrollment date field
            });
          }
        }
        out.subjects = rows;
        rowCounts.subjects = rows.length;
      }

      const wantsQueries = frames.includes("queries");
      const wantsVisits = frames.includes("visits");
      const wantsPages = frames.includes("pages");
      if (wantsQueries || wantsVisits || wantsPages) {
        const tape = await auditTape(
          parsed.baseUrl,
          sourceStudyKey,
          parsed.auditPerPage,
          username,
          password,
        );

        if (wantsQueries) {
          // Replay the tape per query identity; the tape is chronological.
          const byIdentity = new Map<string, QueryRow>();
          for (const e of tape) {
            if (!e.query?.status || !e.dateTimeStamp) continue;
            const identity = [
              e.subjectKey,
              eventKey(e),
              e.formOid,
              e.itemGroupOid,
              e.itemGroupRepeatKey,
              e.itemOid,
              e.query.repeatKey,
            ].join("|");
            const status = canonicalQueryStatus(e.query.status);
            const at = normalizeDateTime(e.dateTimeStamp);
            const existing = byIdentity.get(identity);
            if (!existing) {
              byIdentity.set(identity, {
                source_query_id: identity,
                site_key: e.locationOid ?? null,
                subject_key: e.subjectKey ?? null,
                form_key: e.formOid ?? null,
                origin: null, // unsupported: attribution not publicly confirmable
                status,
                opened_at: at,
                first_response_at: status === "answered" ? at : null,
                closed_at: status === "closed" ? at : null,
              });
            } else {
              existing.status = status;
              if (status === "answered" && existing.first_response_at === null) {
                existing.first_response_at = at;
              }
              if (status === "closed" && existing.closed_at === null) {
                existing.closed_at = at;
              }
            }
          }
          const rows = [...byIdentity.values()];
          out.queries = rows;
          rowCounts.queries = rows.length;
        }

        if (wantsVisits || wantsPages) {
          // "Entered" subcategory per the Medidata techblog (see header).
          const entered = tape.filter(
            (e) =>
              e.subcategory === "Entered" &&
              e.subjectKey !== undefined &&
              e.eventOid !== undefined &&
              e.dateTimeStamp !== undefined,
          );
          if (wantsVisits) {
            const seen = new Map<string, VisitRow>();
            for (const e of entered) {
              const key = `${e.subjectKey}|${eventKey(e)}`;
              if (!seen.has(key)) {
                seen.set(key, {
                  subject_key: e.subjectKey as string,
                  visit_key: eventKey(e),
                  visit_date: null, // unsupported: not an RWS field (see header)
                  occurred: true, // entered data proves occurrence
                });
              }
            }
            out.visits = [...seen.values()];
            rowCounts.visits = (out.visits as VisitRow[]).length;
          }
          if (wantsPages) {
            const seen = new Map<string, PageRow>();
            for (const e of entered) {
              if (e.formOid === undefined) continue;
              const key = `${e.subjectKey}|${eventKey(e)}|${e.formOid}`;
              const at = normalizeDateTime(e.dateTimeStamp as string);
              const existing = seen.get(key);
              if (!existing) {
                seen.set(key, {
                  subject_key: e.subjectKey as string,
                  visit_key: eventKey(e),
                  form_key: e.formOid,
                  status: "in_progress", // conservative: never claims complete
                  first_entered_at: at,
                  sdv_status: null, // unsupported: no page-level SDV rollup
                });
              } else if (at < (existing.first_entered_at as string)) {
                existing.first_entered_at = at;
              }
            }
            out.pages = [...seen.values()];
            rowCounts.pages = (out.pages as PageRow[]).length;
          }
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

export const raveAdapter = createRaveAdapter();
