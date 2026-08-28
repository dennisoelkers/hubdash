import type { TrackedPr } from '../types';

export function aliasFor(index: number): string {
  return `pr${index}`;
}

/** GraphQL string literals follow JSON's escaping rules. */
export function literal(value: string): string {
  return JSON.stringify(value);
}

const PR_FIELDS = `
fragment prFields on PullRequest {
  number
  title
  url
  state
  isDraft
  updatedAt
  author { login }
  baseRefName
  repository { nameWithOwner }
  reviewDecision
  mergeable
  reviewRequests(first: 20) { totalCount }
  latestReviews(first: 20) { nodes { state } }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          state
          contexts(first: 100) {
            totalCount
            nodes {
              __typename
              ... on CheckRun { name conclusion status detailsUrl }
              ... on StatusContext { context state targetUrl }
            }
          }
        }
      }
    }
  }
}`.trim();

/**
 * One request for the whole board, per spec §5.1. Cost is one or two rate-limit
 * points regardless of how many PRs are tracked, so this must never be split
 * into per-PR requests.
 */
export function buildQuery(prs: TrackedPr[]): string {
  const fields = prs
    .map(
      (pr, index) =>
        `  ${aliasFor(index)}: repository(owner: ${literal(pr.owner)}, name: ${literal(pr.repo)}) {\n` +
        `    pullRequest(number: ${pr.number}) { ...prFields }\n` +
        `  }`,
    )
    .join('\n');

  const query = ['query Board {', '  rateLimit { limit cost remaining resetAt }', fields, '}']
    .filter((line) => line !== '')
    .join('\n');

  return prs.length === 0 ? query : `${query}\n\n${PR_FIELDS}\n`;
}
