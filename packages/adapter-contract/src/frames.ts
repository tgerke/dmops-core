import { z } from "zod";

/**
 * Normalized frames (ADR-0005): the shape every source adapter emits,
 * whatever the source system. Transport-plain JSON — snake_case keys,
 * ISO 8601 strings — so a CSV file and an HTTP API produce identical rows.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const isoDateTime = z.string().datetime({ offset: true });

export const queryRow = z
  .object({
    source_query_id: z.string().min(1),
    site_key: z.string().nullable(),
    subject_key: z.string().nullable(),
    form_key: z.string().nullable(),
    origin: z.enum(["manual", "system"]).nullable(),
    status: z.enum(["open", "answered", "closed", "cancelled"]),
    opened_at: isoDateTime,
    first_response_at: isoDateTime.nullable(),
    closed_at: isoDateTime.nullable(),
  })
  .strict();

export const subjectRow = z
  .object({
    subject_key: z.string().min(1),
    site_key: z.string().nullable(),
    status: z.enum(["screening", "enrolled", "completed", "withdrawn", "screen_failed"]),
    enrolled_date: isoDate.nullable(),
  })
  .strict();

export const visitRow = z
  .object({
    subject_key: z.string().min(1),
    visit_key: z.string().min(1),
    visit_date: isoDate.nullable(),
    occurred: z.boolean(),
  })
  .strict();

export const pageRow = z
  .object({
    subject_key: z.string().min(1),
    visit_key: z.string().nullable(),
    form_key: z.string().min(1),
    status: z.enum(["not_started", "in_progress", "complete", "locked"]),
    first_entered_at: isoDateTime.nullable(),
    sdv_status: z.enum(["not_required", "pending", "verified"]).nullable(),
  })
  .strict();

export const frameSchemas = {
  queries: queryRow,
  subjects: subjectRow,
  visits: visitRow,
  pages: pageRow,
} as const;

export type FrameName = keyof typeof frameSchemas;
export const frameNames = Object.keys(frameSchemas) as FrameName[];

export type QueryRow = z.infer<typeof queryRow>;
export type SubjectRow = z.infer<typeof subjectRow>;
export type VisitRow = z.infer<typeof visitRow>;
export type PageRow = z.infer<typeof pageRow>;

export interface NormalizedFrames {
  queries?: QueryRow[];
  subjects?: SubjectRow[];
  visits?: VisitRow[];
  pages?: PageRow[];
}
