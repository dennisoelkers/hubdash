import { prKey } from '../domain/prKey';
import type { NormalisedPr } from '../types';

export function makePr(overrides: Partial<NormalisedPr> = {}): NormalisedPr {
  const owner = overrides.owner ?? 'Example';
  const repo = overrides.repo ?? 'example-server';
  const number = overrides.number ?? 4821;
  return {
    key: prKey(owner, repo, number),
    owner,
    repo,
    number,
    title: 'Fix index rotation',
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
    author: 'octocat',
    nameWithOwner: `${owner}/${repo}`,
    baseRefName: 'master',
    updatedAt: '2026-08-27T10:00:00Z',
    lifecycle: 'OPEN',
    isDraft: false,
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable: 'MERGEABLE',
    ci: 'success',
    failingCheckCount: 0,
    approvalCount: 0,
    requestedReviewerCount: 0,
    ...overrides,
  };
}
