import { appDatabaseUrl, createDb, loadEnv } from "@dmops/db";
import { serve } from "@hono/node-server";
import { buildApp } from "./app.js";
import { assertAuthConfig } from "./auth.js";

loadEnv();
assertAuthConfig();
// The API always runs as the least-privilege dmops_app role — dev included,
// so privilege bugs surface before production (ADR-0003).
const { sql } = createDb(appDatabaseUrl());
const app = buildApp(sql);
const port = Number(process.env.DMOPS_API_PORT ?? 8788);

serve({ fetch: app.fetch, port }, () => {
  console.log(`dmops-core api on http://localhost:${port} (docs at /docs)`);
});
