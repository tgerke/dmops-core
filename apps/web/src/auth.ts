/**
 * Dev-token persona picker. Each token maps to a seeded person whose study
 * assignments drive the role-scoped view (DM-P5). Production replaces this
 * with an OIDC login against the same API.
 */
export interface Persona {
  token: string;
  label: string;
  canWriteMilestones: boolean;
  // UAT writes are open to analysts too (ADR-0010) — wider than milestones.
  canWriteUat: boolean;
}

export const personas: Persona[] = [
  {
    token: "dev-dmlead-token",
    label: "Maya Okafor — DM lead",
    canWriteMilestones: true,
    canWriteUat: true,
  },
  {
    token: "dev-manager-token",
    label: "Daniel Reyes — DM manager",
    canWriteMilestones: true,
    canWriteUat: true,
  },
  {
    token: "dev-analyst-token",
    label: "Priya Natarajan — Analyst (UAT)",
    canWriteMilestones: false,
    canWriteUat: true,
  },
  {
    token: "dev-clinops-token",
    label: "Grace Liu — ClinOps (read-only)",
    canWriteMilestones: false,
    canWriteUat: false,
  },
  {
    token: "dev-sponsor-token",
    label: "Sylvia Tran — Sponsor (curated view)",
    canWriteMilestones: false,
    canWriteUat: false,
  },
  {
    token: "dev-qa-token",
    label: "Ruth Adler — QA (portfolio, read-only)",
    canWriteMilestones: false,
    canWriteUat: false,
  },
  {
    token: "dev-admin-token",
    label: "Alex Admin — Admin",
    canWriteMilestones: true,
    canWriteUat: true,
  },
];

const KEY = "dmops.token";

export function currentPersona(): Persona {
  const token = localStorage.getItem(KEY) ?? personas[0]!.token;
  return personas.find((p) => p.token === token) ?? personas[0]!;
}

export function setPersona(token: string): void {
  localStorage.setItem(KEY, token);
}
