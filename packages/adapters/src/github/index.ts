import {
  type AdapterCapabilities,
  type ExtractionResult,
  type FrameName,
  type IssueRow,
  type PullRequestRow,
  type ReviewRow,
  type SourceAdapter,
  checksumFrames,
} from "@dmops/adapter-contract";
import { z } from "zod";

/**
 * GitHub adapter (ADR-0012): reads the repositories named in
 * study_source.config through the GitHub REST API and emits the
 * repository-work frames. Read-only, like every adapter (ADR-0005).
 *
 * Capability posture verified against the GitHub REST API reference at
 * docs.github.com (X-GitHub-Api-Version: 2026-03-10, consulted 2026-07-30)
 * and, for review states, GitHub's published GraphQL schema
 * (docs.github.com/public/fpt/schema.docs.graphql, same date):
 *
 * - issues: "List repository issues" returns native id/number, state
 *   (open|closed), created_at, closed_at. The endpoint returns pull requests
 *   too — "GitHub's REST API considers every pull request an issue" — and
 *   they are identified by the `pull_request` key, which this adapter
 *   filters out. repo_key is DERIVED from the requested repository, not a
 *   response field.
 * - pull_requests: "List pull requests" returns native number, created_at,
 *   merged_at, closed_at. The response state is only open|closed — merged is
 *   NOT a state; a merged PR is closed with non-null merged_at — so the
 *   contract's three-valued state is DERIVED.
 * - reviews: "List reviews for a pull request" returns native id, user
 *   (login), state, submitted_at, in chronological order. States per the
 *   GraphQL PullRequestReviewState enum: APPROVED, CHANGES_REQUESTED,
 *   COMMENTED, DISMISSED, PENDING. Pending reviews are unsubmitted, carry no
 *   submitted_at, and are excluded here. source_pr_id and repo_key are
 *   DERIVED from the request path (reviews are listed per PR).
 *
 * Pagination follows the Link header rel="next" URL, per "Using pagination
 * in the REST API" (same docs version).
 */
const configSchema = z
  .object({
    /** Repositories feeding the study, each "owner/name" (ADR-0012). */
    repos: z.array(z.string().regex(/^[^/\s]+\/[^/\s]+$/, "owner/name")).min(1),
    /** Name of the env var holding the token — env indirection, so secrets
     * never sit in study_source.config. */
    apiTokenEnv: z.string().min(1),
    baseUrl: z.string().url().default("https://api.github.com"),
  })
  .strict();

// Response shapes we read (fields per the docs cited in the header).
interface GhIssue {
  number: number;
  state: "open" | "closed";
  created_at: string;
  closed_at: string | null;
  pull_request?: unknown;
}

interface GhPull {
  number: number;
  state: "open" | "closed";
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
}

interface GhReview {
  id: number;
  user: { login: string } | null;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  submitted_at?: string;
}

const REPO_FRAMES: FrameName[] = ["issues", "pull_requests", "reviews"];

export function createGithubAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  /** GET a paginated listing, following Link rel="next" to exhaustion. */
  async function getAll<T>(url: string, token: string): Promise<T[]> {
    const rows: T[] = [];
    let next: string | null = url;
    while (next) {
      const res: Response = await fetchImpl(next, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2026-03-10",
          "user-agent": "dmops-core",
        },
      });
      if (!res.ok) {
        throw new Error(`github GET ${next} failed: ${res.status} ${res.statusText}`);
      }
      rows.push(...((await res.json()) as T[]));
      const link: string = res.headers.get("link") ?? "";
      next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    }
    return rows;
  }

  return {
    id: "github",

    capabilities(): AdapterCapabilities {
      // EDC frames (queries, subjects, visits, pages) are undeclared:
      // fail-closed means unsupported (ADR-0005). Citations in the header.
      return {
        adapter: "github",
        frames: {
          issues: {
            supported: true,
            fields: {
              source_issue_id: "native",
              repo_key: "derived",
              state: "native",
              opened_at: "native",
              closed_at: "native",
            },
            notes:
              "repo_key derived from the requested repository; pull requests returned by the " +
              "issues endpoint are filtered out via their pull_request key",
          },
          pull_requests: {
            supported: true,
            fields: {
              source_pr_id: "native",
              repo_key: "derived",
              state: "derived",
              opened_at: "native",
              merged_at: "native",
              closed_at: "native",
            },
            notes:
              "GitHub's PR state is only open|closed; 'merged' derived as closed with " +
              "non-null merged_at",
          },
          reviews: {
            supported: true,
            fields: {
              source_review_id: "native",
              source_pr_id: "derived",
              repo_key: "derived",
              reviewer_key: "native",
              state: "native",
              submitted_at: "native",
            },
            notes:
              "pending (unsubmitted) reviews excluded; source_pr_id and repo_key derived from " +
              "the request path; reviewer_key falls back to 'unknown' when the account is gone",
          },
        },
      };
    },

    async extract({ frames, config }): Promise<ExtractionResult> {
      const { repos, apiTokenEnv, baseUrl } = configSchema.parse(config);
      const token = process.env[apiTokenEnv];
      if (!token) {
        throw new Error(`github adapter: env var ${apiTokenEnv} is not set (see .env.example)`);
      }
      const unsupported = frames.filter((f) => !REPO_FRAMES.includes(f));
      if (unsupported.length > 0) {
        throw new Error(
          `github adapter cannot extract: ${unsupported.join(", ")} (declared unsupported)`,
        );
      }

      const issues: IssueRow[] = [];
      const pulls: PullRequestRow[] = [];
      const reviews: ReviewRow[] = [];
      const wantsPulls = frames.includes("pull_requests");
      const wantsReviews = frames.includes("reviews");

      for (const repo of repos) {
        if (frames.includes("issues")) {
          const raw = await getAll<GhIssue>(
            `${baseUrl}/repos/${repo}/issues?state=all&per_page=100`,
            token,
          );
          for (const i of raw) {
            if (i.pull_request !== undefined) continue; // a PR, not an issue
            issues.push({
              source_issue_id: String(i.number),
              repo_key: repo,
              state: i.state,
              opened_at: i.created_at,
              closed_at: i.closed_at,
            });
          }
        }

        if (wantsPulls || wantsReviews) {
          // Reviews are listed per PR, so the PR listing backs both frames.
          const raw = await getAll<GhPull>(
            `${baseUrl}/repos/${repo}/pulls?state=all&per_page=100`,
            token,
          );
          if (wantsPulls) {
            for (const p of raw) {
              pulls.push({
                source_pr_id: String(p.number),
                repo_key: repo,
                state: p.merged_at !== null ? "merged" : p.state,
                opened_at: p.created_at,
                merged_at: p.merged_at,
                closed_at: p.closed_at,
              });
            }
          }
          if (wantsReviews) {
            for (const p of raw) {
              const rawReviews = await getAll<GhReview>(
                `${baseUrl}/repos/${repo}/pulls/${p.number}/reviews?per_page=100`,
                token,
              );
              for (const r of rawReviews) {
                if (r.state === "PENDING" || !r.submitted_at) continue; // unsubmitted
                reviews.push({
                  source_review_id: String(r.id),
                  source_pr_id: String(p.number),
                  repo_key: repo,
                  reviewer_key: r.user?.login ?? "unknown",
                  state: r.state.toLowerCase() as ReviewRow["state"],
                  submitted_at: r.submitted_at,
                });
              }
            }
          }
        }
      }

      const out: Partial<Record<FrameName, unknown[]>> = {};
      if (frames.includes("issues")) out.issues = issues;
      if (wantsPulls) out.pull_requests = pulls;
      if (wantsReviews) out.reviews = reviews;
      const rowCounts = Object.fromEntries(
        Object.entries(out).map(([frame, rows]) => [frame, rows.length]),
      );
      return {
        extracted_at: new Date().toISOString(),
        frames: out,
        row_counts: rowCounts,
        checksum: checksumFrames(out as Record<string, unknown[]>),
      };
    },
  };
}

export const githubAdapter = createGithubAdapter();
