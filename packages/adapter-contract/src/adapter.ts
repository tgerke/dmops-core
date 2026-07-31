import type { z } from "zod";
import type { AdapterCapabilities } from "./capabilities.js";
import { type FrameName, frameSchemas } from "./frames.js";

/** What an adapter returns from one extraction run. */
export interface ExtractionResult {
  /** ISO 8601 timestamp of the extraction. */
  extracted_at: string;
  /** Raw frame rows; validated by validateExtraction before anything is written. */
  frames: Partial<Record<FrameName, unknown[]>>;
  row_counts: Partial<Record<FrameName, number>>;
  /** sha256 over canonical JSON of frames — use checksumFrames(). */
  checksum: string;
}

/**
 * The source adapter contract (ADR-0005). Read-only: adapters extract
 * normalized frames from a source system; they never write to it.
 *
 * `config` is the study's `study_source.config` — adapter-specific and
 * non-secret. Credentials go through environment indirection (config names
 * an env var, never a key).
 */
export interface SourceAdapter {
  readonly id: string;
  /**
   * Capability posture. May depend on the study's `study_source.config`
   * (ADR-0018) — e.g. a per-study CRF mapping that makes a field derivable.
   * Must never throw: absent or invalid config yields the conservative
   * posture. Adapters with a config-independent posture ignore the argument.
   */
  capabilities(config?: Record<string, unknown>): AdapterCapabilities;
  extract(input: {
    sourceStudyKey: string;
    frames: FrameName[];
    config: Record<string, unknown>;
  }): Promise<ExtractionResult>;
}

export class FrameValidationError extends Error {
  constructor(
    readonly frame: FrameName,
    readonly rowIndex: number,
    readonly issues: z.ZodIssue[],
  ) {
    super(
      `frame '${frame}' row ${rowIndex} failed validation: ${issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
}

/**
 * Validate every row of every frame against the contract schemas. Called by
 * the snapshot pipeline before a source_extract row is written; adapters can
 * also call it on themselves in tests.
 */
export function validateExtraction(result: ExtractionResult): void {
  for (const [frame, rows] of Object.entries(result.frames) as [FrameName, unknown[]][]) {
    const schema = frameSchemas[frame];
    if (!schema) throw new Error(`unknown frame '${frame}'`);
    rows.forEach((row, i) => {
      const parsed = schema.safeParse(row);
      if (!parsed.success) throw new FrameValidationError(frame, i, parsed.error.issues);
    });
    if (result.row_counts[frame] !== rows.length) {
      throw new Error(
        `frame '${frame}' row_counts mismatch: declared ${result.row_counts[frame]}, actual ${rows.length}`,
      );
    }
  }
}
