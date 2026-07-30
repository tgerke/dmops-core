#!/usr/bin/env node
// Docs screenshot generator — reproduces every site/src/assets/screenshots/*.png
// against the seeded dev stack, so a UI refresh is one command instead of an
// ad-hoc Playwright session. See CONTRIBUTING.md ("Refreshing docs
// screenshots") for the recipe.
//
// What it does, in order:
//   1. Reseeds the database (pnpm db:up + db:migrate + db:seed). The seed is
//      destructive and truncates the append-only tables as the owning role, so
//      unlike edc-core (where state setup is additive-idempotent and canonical
//      shots need a fresh stack), here the destruction IS the idempotency
//      mechanism: every run starts from the same canonical portfolio.
//   2. Starts `pnpm dev` if the API (:8788) isn't responding, and waits on
//      /health.
//   3. Discovers study UUIDs via GET /studies — the seed regenerates every
//      UUID, so nothing is hard-coded; studies are addressed by protocol
//      number.
//   4. Creates the one reference state the seed lacks: a re-baseline on
//      DMOPS-001 COND.INTERIM (as Daniel Reyes, DM manager), so the ⟲1
//      governance badge renders. Safe on the append-only table only because
//      step 1 truncated it.
//   5. Captures each shot at 1440x900, deviceScaleFactor 2 — one browser
//      context per persona (the persona is just localStorage["dmops.token"]).
//
// Usage: node scripts/screenshots.mjs --yes [--only name,name] [--out dir]
//
// --yes acknowledges the destructive reseed: never point this at a database
// whose contents you care about.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WEB_URL = process.env.DMOPS_WEB_URL ?? "http://localhost:5175";
const API_URL = process.env.DMOPS_API_URL ?? "http://localhost:8788";
const VIEWPORT = { width: 1440, height: 900 };

const TOKENS = {
  dmlead: "dev-dmlead-token",
  manager: "dev-manager-token",
  sponsor: "dev-sponsor-token",
};

const args = process.argv.slice(2);
function flagValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const only = flagValue("--only")
  ?.split(",")
  .map((s) => s.trim());
const outDir = path.resolve(root, flagValue("--out") ?? "site/src/assets/screenshots");

if (!args.includes("--yes")) {
  console.error(
    "This script RESEEDS the database at your local DATABASE_URL, destroying its contents\n" +
      "(including the audit trail). Re-run with --yes to confirm.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Stack

function run(cmd, cmdArgs) {
  const res = spawnSync(cmd, cmdArgs, { cwd: root, stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${cmdArgs.join(" ")} exited with ${res.status}`);
  }
}

async function up(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await up(url)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} did not come up at ${url}`);
}

console.log("[screenshots] reseeding the demo portfolio…");
run("pnpm", ["db:up"]);
run("pnpm", ["db:migrate"]);
run("pnpm", ["db:seed"]);

if (!(await up(`${API_URL}/health`))) {
  console.log("[screenshots] starting pnpm dev (left running afterwards)…");
  const dev = spawn("pnpm", ["dev"], { cwd: root, detached: true, stdio: "ignore" });
  dev.unref();
}
await waitFor(`${API_URL}/health`, "API");
await waitFor(WEB_URL, "web app");

// ---------------------------------------------------------------------------
// Reference state the seed lacks

async function api(method, pathName, token, body) {
  const res = await fetch(`${API_URL}${pathName}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${pathName} -> ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

const studies = await api("GET", "/studies", TOKENS.dmlead);
const byProtocol = Object.fromEntries(studies.map((s) => [s.protocol_number, s.study_id]));
const study1 = byProtocol["DMOPS-001"];
const study2 = byProtocol["DMOPS-002"];
if (!study1 || !study2) {
  throw new Error(`expected DMOPS-001 and DMOPS-002 in /studies, got ${Object.keys(byProtocol)}`);
}

// The seed never re-baselines, so the ⟲N badge exists nowhere without this.
// Only ever appended right after a truncating seed, so re-runs stay at ⟲1.
const board = await api("GET", `/studies/${study1}/milestones`, TOKENS.manager);
const interim = board.milestones.find((m) => m.code === "COND.INTERIM");
if (!interim) throw new Error("DMOPS-001 has no COND.INTERIM milestone");
if (interim.rebaseline_count === 0) {
  await api("POST", `/studies/${study1}/milestones/COND.INTERIM/rebaseline`, TOKENS.manager, {
    planned_date: "2026-10-06",
    reason: "Amendment 3 shifted the interim analysis cut; re-planned at the Jul governance review",
    reference_uri: "https://ctms.example/tmf/DMOPS-001/gov-2026-07",
  });
  const after = await api("GET", `/studies/${study1}/milestones`, TOKENS.manager);
  const check = after.milestones.find((m) => m.code === "COND.INTERIM");
  if (!check || check.rebaseline_count < 1) {
    throw new Error("rebaseline POST succeeded but the board does not show it");
  }
  console.log("[screenshots] re-baselined DMOPS-001 COND.INTERIM (⟲1)");
}

// ---------------------------------------------------------------------------
// Shots

/** Expand every collapsed UAT cycle card so defect tables are visible. */
async function expandUatCycles(page) {
  // Clicking ▸ flips it to ▾, so always take the first remaining one.
  const collapsed = page.locator("section:has(h2:text-is('UAT')) button", { hasText: "▸" });
  while ((await collapsed.count()) > 0) {
    await collapsed.first().click();
    await page.waitForLoadState("networkidle");
  }
}

const boardSection = (title) => `section:has(h2:text-is('${title}'))`;

// name -> { path, persona, fullPage?, locator?, run? }
const shots = [
  {
    name: "studies",
    path: "/",
    persona: "dmlead",
    fullPage: true,
  },
  {
    name: "board-hero",
    path: `/studies/${study1}`,
    persona: "dmlead",
  },
  {
    name: "study-board",
    path: `/studies/${study1}`,
    persona: "dmlead",
    fullPage: true,
    run: expandUatCycles,
  },
  {
    name: "metrics-strip",
    path: `/studies/${study1}`,
    persona: "dmlead",
    // MetricsStrip is the only non-<section> child of the board column.
    locator: "main > div > div",
  },
  {
    name: "metric-drilldown",
    path: `/studies/${study1}`,
    persona: "dmlead",
    locator: "main > div > div",
    run: async (page) => {
      // Query TAT has site grain, so the by-site table has rows to show.
      await page
        .locator("main > div > div button:enabled", { hasText: "Query turnaround" })
        .click();
      await page.waitForSelector("text=Trend by reporting period");
      await page.waitForLoadState("networkidle");
    },
  },
  {
    name: "deliverables",
    path: `/studies/${study1}`,
    persona: "dmlead",
    locator: boardSection("Deliverables"),
  },
  {
    name: "uat-cycles",
    path: `/studies/${study1}`,
    persona: "dmlead",
    locator: boardSection("UAT"),
    run: expandUatCycles,
  },
  {
    name: "milestones-conduct",
    path: `/studies/${study1}`,
    persona: "dmlead",
    locator: boardSection("Conduct"),
  },
  {
    name: "milestones-closeout",
    path: `/studies/${study1}`,
    persona: "dmlead",
    locator: boardSection("Closeout"),
  },
  {
    name: "sponsor-view",
    path: `/studies/${study1}`,
    persona: "sponsor",
    locator: boardSection("Closeout"),
  },
  {
    name: "board-startup",
    path: `/studies/${study2}`,
    persona: "dmlead",
    fullPage: true,
  },
  {
    name: "api-scalar",
    path: `${API_URL}/docs`,
    persona: "dmlead",
  },
];

const wanted = only ? shots.filter((s) => only.includes(s.name)) : shots;
if (wanted.length === 0) {
  throw new Error(`--only matched nothing; names: ${shots.map((s) => s.name).join(", ")}`);
}

mkdirSync(outDir, { recursive: true });

const { chromium } = await import("playwright");
const browser = await chromium.launch();

const contexts = new Map();
async function contextFor(persona) {
  if (!contexts.has(persona)) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const token = TOKENS[persona];
    await ctx.addInitScript((t) => localStorage.setItem("dmops.token", t), token);
    contexts.set(persona, ctx);
  }
  return contexts.get(persona);
}

for (const shot of wanted) {
  const ctx = await contextFor(shot.persona);
  const page = await ctx.newPage();
  const url = shot.path.startsWith("http") ? shot.path : `${WEB_URL}${shot.path}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  if (shot.run) await shot.run(page);
  await page.waitForTimeout(250);

  const file = path.join(outDir, `${shot.name}.png`);
  if (shot.locator) {
    await page.locator(shot.locator).screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: shot.fullPage ?? false });
  }
  console.log(`[screenshots] ${shot.name}.png`);
  await page.close();
}

await browser.close();
console.log(`[screenshots] done -> ${path.relative(root, outDir)}`);
