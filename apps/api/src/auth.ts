import { type Actor, type Assignment, assignmentsFor } from "@dmops/core";
import type { Sql } from "@dmops/db";
import type { Context, MiddlewareHandler, Next } from "hono";
import { type JWTPayload, createRemoteJWKSet, jwtVerify } from "jose";

export type Env = {
  Variables: {
    actor: Actor;
    assignments: Assignment[];
  };
};

export type AuthMode = "dev" | "oidc";

/**
 * DMOPS_AUTH_MODE selects the identity source. `dev` maps static bearer
 * tokens to seeded people (demo only — not a production access-control
 * posture); `oidc` validates JWTs from a real identity provider. The mode
 * must be explicit: a deployment that forgot to configure auth should not
 * boot.
 */
export function authMode(): AuthMode {
  const mode = process.env.DMOPS_AUTH_MODE;
  if (mode === "dev" || mode === "oidc") return mode;
  throw new Error(
    "DMOPS_AUTH_MODE must be 'dev' or 'oidc' (see .env.example). Refusing to start without an explicit auth mode.",
  );
}

export function assertAuthConfig(): void {
  if (authMode() !== "oidc") return;
  for (const key of ["DMOPS_OIDC_ISSUER", "DMOPS_OIDC_AUDIENCE"]) {
    if (!process.env[key]) {
      throw new Error(`DMOPS_AUTH_MODE=oidc requires ${key} to be set`);
    }
  }
}

// --- dev mode ---------------------------------------------------------------

const tokenToEmail = new Map<string, { email: string; roleLabel: string }>();

export function configureTokens(): void {
  tokenToEmail.set(process.env.DMOPS_TOKEN_DM_LEAD ?? "dev-dmlead-token", {
    email: "maya.okafor@pmo.example",
    roleLabel: "DM lead",
  });
  tokenToEmail.set(process.env.DMOPS_TOKEN_DM_MANAGER ?? "dev-manager-token", {
    email: "daniel.reyes@pmo.example",
    roleLabel: "DM manager",
  });
  // Analysts execute UAT and log defects (ADR-0010) — the first write-capable
  // non-leadership seat.
  tokenToEmail.set(process.env.DMOPS_TOKEN_ANALYST ?? "dev-analyst-token", {
    email: "priya.natarajan@pmo.example",
    roleLabel: "analyst",
  });
  tokenToEmail.set(process.env.DMOPS_TOKEN_CLINOPS ?? "dev-clinops-token", {
    email: "grace.liu@pmo.example",
    roleLabel: "ClinOps",
  });
  // Sponsor seat exists from day one so the curated-view surface is
  // exercised before field-level ACL configuration lands (DM-P5).
  tokenToEmail.set(process.env.DMOPS_TOKEN_SPONSOR ?? "dev-sponsor-token", {
    email: "sylvia.tran@meridian.example",
    roleLabel: "sponsor",
  });
  tokenToEmail.set(process.env.DMOPS_TOKEN_QA ?? "dev-qa-token", {
    email: "ruth.adler@gcpaudit.example",
    roleLabel: "QA",
  });
  tokenToEmail.set(process.env.DMOPS_TOKEN_ADMIN ?? "dev-admin-token", {
    email: "alex.admin@pmo.example",
    roleLabel: "admin",
  });
}

// --- oidc mode ----------------------------------------------------------------

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

async function getJwks() {
  if (jwks) return jwks;
  let jwksUri = process.env.DMOPS_OIDC_JWKS_URI;
  if (!jwksUri) {
    const issuer = process.env.DMOPS_OIDC_ISSUER!;
    const discoveryUrl = new URL(
      ".well-known/openid-configuration",
      issuer.endsWith("/") ? issuer : `${issuer}/`,
    );
    const res = await fetch(discoveryUrl);
    if (!res.ok) throw new Error(`OIDC discovery failed (${res.status}) at ${discoveryUrl}`);
    jwksUri = ((await res.json()) as { jwks_uri: string }).jwks_uri;
  }
  jwks = createRemoteJWKSet(new URL(jwksUri));
  return jwks;
}

async function verifyOidcToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, await getJwks(), {
    issuer: process.env.DMOPS_OIDC_ISSUER,
    audience: process.env.DMOPS_OIDC_AUDIENCE,
  });
  return payload;
}

function emailClaim(payload: JWTPayload): string | null {
  const claim = process.env.DMOPS_OIDC_EMAIL_CLAIM ?? "email";
  const value = payload[claim];
  if (typeof value !== "string" || value === "") return null;
  if (payload.email_verified === false) return null;
  return value;
}

// --- authentication middleware ----------------------------------------------

/**
 * Resolve the bearer credential to a person and their active study
 * assignments. 401 = credential invalid; 403 = valid identity with no person
 * record (authenticated but not provisioned). No fallback actor: an identity
 * the system cannot attribute must not write (ADR-0003).
 */
export function authMiddleware(sql: Sql): MiddlewareHandler<Env> {
  const mode = authMode();
  return async (c: Context<Env>, next: Next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.replace(/^Bearer\s+/i, "");
    if (!token) return c.json({ error: "missing bearer token" }, 401);

    let email: string;
    let roleLabel: string | null = null;
    if (mode === "dev") {
      const mapped = tokenToEmail.get(token);
      if (!mapped) return c.json({ error: "missing or invalid bearer token" }, 401);
      email = mapped.email;
      roleLabel = mapped.roleLabel;
    } else {
      let payload: JWTPayload;
      try {
        payload = await verifyOidcToken(token);
      } catch {
        return c.json({ error: "missing or invalid bearer token" }, 401);
      }
      const claimed = emailClaim(payload);
      if (!claimed) {
        return c.json({ error: "token carries no verified email identity" }, 403);
      }
      email = claimed;
    }

    // Resolved per request (single indexed lookup): person ids change on
    // re-seed, so caching the mapping goes stale.
    const [person] = await sql`
      SELECT id, name FROM person WHERE email = ${email} AND active`;
    if (!person) {
      return c.json({ error: `no person record for authenticated identity ${email}` }, 403);
    }
    c.set("actor", {
      personId: person.id as string,
      label: `${person.name}${roleLabel ? ` (${roleLabel})` : ""}`,
    });
    c.set("assignments", await assignmentsFor(sql, person.id as string));
    await next();
  };
}
