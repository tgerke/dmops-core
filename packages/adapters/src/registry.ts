import type { SourceAdapter } from "@dmops/adapter-contract";
import { csvAdapter } from "./csv/index.js";
import { edcCoreAdapter } from "./edc-core/index.js";
import { githubAdapter } from "./github/index.js";
import { medrioAdapter } from "./medrio/index.js";
import { raveAdapter } from "./rave/index.js";

/**
 * In-tree adapters, keyed by study_source.adapter. External adapters
 * (npm packages implementing the contract) can be added here by a
 * deployment fork or a future plugin loader — see
 * docs/adapters/writing-an-adapter.md.
 */
const adapters = new Map<string, SourceAdapter>([
  [csvAdapter.id, csvAdapter],
  [edcCoreAdapter.id, edcCoreAdapter],
  [githubAdapter.id, githubAdapter],
  [medrioAdapter.id, medrioAdapter],
  [raveAdapter.id, raveAdapter],
]);

export function getAdapter(id: string): SourceAdapter {
  const adapter = adapters.get(id);
  if (!adapter) {
    throw new Error(`unknown adapter '${id}' (registered: ${[...adapters.keys()].join(", ")})`);
  }
  return adapter;
}

export function registeredAdapters(): string[] {
  return [...adapters.keys()];
}
