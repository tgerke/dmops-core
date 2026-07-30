import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseUrl } from "./env.js";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>["db"];
export type Sql = ReturnType<typeof postgres>;

export function createDb(url: string = databaseUrl()) {
  const sql = postgres(url, { onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { sql, db };
}
