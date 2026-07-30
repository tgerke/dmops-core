import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

let loaded = false;

/** Minimal .env loader: walks up from cwd, never overrides real env vars. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      for (const line of readFileSync(candidate, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && m[1] && process.env[m[1]] === undefined) {
          process.env[m[1]] = m[2] ?? "";
        }
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function databaseUrl(): string {
  loadEnv();
  return process.env.DMOPS_DATABASE_URL ?? "postgres://dmops:dmops@localhost:5434/dmops";
}

/**
 * Connection for the API runtime: the least-privilege dmops_app role
 * (DML only — no TRUNCATE, no DDL, no trigger disablement, no direct
 * audit_event writes, no UPDATE/DELETE on the append-only warehouse).
 * Migrations and seed keep the owning role via DMOPS_DATABASE_URL.
 */
export function appDatabaseUrl(): string {
  loadEnv();
  if (process.env.DMOPS_DATABASE_URL_APP) return process.env.DMOPS_DATABASE_URL_APP;
  const url = new URL(databaseUrl());
  url.username = "dmops_app";
  url.password = process.env.DMOPS_APP_PASSWORD ?? "dmops_app";
  return url.toString();
}
