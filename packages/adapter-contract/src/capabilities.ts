import type { FrameName } from "./frames.js";

/**
 * Capability declarations (ADR-0005). Adapters state, per frame and per
 * field, what their source can honestly supply:
 *
 * - `native`      — the source stores exactly this fact
 * - `derived`     — the adapter computed it (say how in `notes`)
 * - `unsupported` — the source cannot supply it
 *
 * Metrics gate on these: a metric whose required field is `unsupported` is
 * skipped and reported unavailable with the named gap — never silently
 * approximated.
 */
export type FieldSupport = "native" | "derived" | "unsupported";

export interface FrameCapability {
  supported: boolean;
  fields: Record<string, FieldSupport>;
  /** Caveats an operator should know, e.g. how a derived field is computed. */
  notes?: string;
}

export interface AdapterCapabilities {
  adapter: string;
  frames: Partial<Record<FrameName, FrameCapability>>;
}

/** Where a metric's required field stands with a given adapter. */
export function fieldSupport(
  capabilities: AdapterCapabilities,
  frame: FrameName,
  field: string,
): FieldSupport {
  const frameCap = capabilities.frames[frame];
  if (!frameCap || !frameCap.supported) return "unsupported";
  return frameCap.fields[field] ?? "unsupported";
}
