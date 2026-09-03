import type { TrackedTask } from '../types';

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

/** Issues carry none of a PR's CI/review/mergeable/draft fields — see spec §6. */
const ISSUE_FIELDS = `
fragment issueFields on Issue {
  number
  title
  url
  state
  updatedAt
  author { login }
  repository { nameWithOwner }
}`.trim();

function fieldFor(target: TrackedTask, index: number): string {
  const selection =
    target.kind === 'issue'
      ? `issue(number: ${target.number}) { ...issueFields }`
      : `pullRequest(number: ${target.number}) { ...prFields }`;
  return (
    `  ${aliasFor(index)}: repository(owner: ${literal(target.owner)}, name: ${literal(target.repo)}) {\n` +
    `    ${selection}\n` +
    `  }`
  );
}

/**
 * One request for everything tracked across all three tabs, per spec §4.
 * Cost is one or two rate-limit points regardless of how many things are
 * tracked, so this must never be split into per-tab requests.
 */
export function buildQuery(targets: TrackedTask[]): string {
  const fields = targets.map(fieldFor).join('\n');

  const query = ['query Board {', '  rateLimit { limit cost remaining resetAt }', fields, '}']
    .filter((line) => line !== '')
    .join('\n');

  if (targets.length === 0) return query;

  const usesPr = targets.some((target) => target.kind === 'pr');
  const usesIssue = targets.some((target) => target.kind === 'issue');
  const fragments = [usesPr ? PR_FIELDS : '', usesIssue ? ISSUE_FIELDS : '']
    .filter((fragment) => fragment !== '')
    .join('\n\n');

  return `${query}\n\n${fragments}\n`;
}
