import type { NormalisedIssue } from '../types';

/**
 * Issues carry none of the CI/review/mergeable/draft signals classify() for
 * PRs depends on, so this is a plain two-state model: whether it's still
 * open. `needsAction`/`ready` never apply to an issue in this app (spec §6).
 */
export function classifyIssue(issue: NormalisedIssue): 'waiting' | 'archive' {
  return issue.lifecycle === 'CLOSED' ? 'archive' : 'waiting';
}
