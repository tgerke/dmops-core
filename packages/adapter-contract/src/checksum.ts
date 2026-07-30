import { createHash } from "node:crypto";

/**
 * Stable checksum over frame payloads: keys sorted recursively, then
 * sha256 over the canonical JSON. Every adapter uses this helper so
 * extraction checksums are comparable across sources (ADR-0005).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

export function checksumFrames(frames: Record<string, unknown[]>): string {
  return createHash("sha256").update(canonicalJson(frames)).digest("hex");
}
