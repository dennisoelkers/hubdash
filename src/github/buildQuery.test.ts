import { describe, expect, it } from 'vitest';
import type { TrackedPr } from '../types';
import { aliasFor, buildQuery } from './buildQuery';

const prs: TrackedPr[] = [
  { owner: 'Example', repo: 'example-server', number: 4821, addedAt: '2026-08-27T09:00:00Z' },
  { owner: 'Example', repo: 'example-plugin-enterprise', number: 912, addedAt: '2026-08-27T09:00:00Z' },
];

describe('aliasFor', () => {
  it('names the nth aliased field', () => {
    expect(aliasFor(0)).toBe('pr0');
    expect(aliasFor(12)).toBe('pr12');
  });
});

describe('buildQuery', () => {
  it('always asks for the rate limit', () => {
    expect(buildQuery(prs)).toContain('rateLimit');
  });

  it('emits one aliased repository field per tracked PR', () => {
    const query = buildQuery(prs);
    expect(query).toContain('pr0: repository(owner: "Example", name: "example-server")');
    expect(query).toContain('pullRequest(number: 4821)');
    expect(query).toContain('pr1: repository(owner: "Example", name: "example-plugin-enterprise")');
    expect(query).toContain('pullRequest(number: 912)');
  });

  it('includes every field the normaliser needs', () => {
    const query = buildQuery(prs);
    for (const field of [
      'reviewDecision',
      'mergeable',
      'isDraft',
      'updatedAt',
      'statusCheckRollup',
      'latestReviews',
      'reviewRequests',
      'nameWithOwner',
      'baseRefName',
    ]) {
      expect(query, field).toContain(field);
    }
  });

  it('declares the fragment exactly once no matter how many PRs', () => {
    const occurrences = buildQuery(prs).match(/fragment prFields on PullRequest/g);
    expect(occurrences).toHaveLength(1);
  });

  it('escapes owner and repo so a crafted name cannot break out of the string', () => {
    const query = buildQuery([
      { owner: 'a"b', repo: 'c\\d', number: 1, addedAt: '2026-08-27T09:00:00Z' },
    ]);
    expect(query).toContain('owner: "a\\"b"');
    expect(query).toContain('name: "c\\\\d"');
  });

  it('produces a valid query with no PRs', () => {
    const query = buildQuery([]);
    expect(query).toContain('rateLimit');
    expect(query).not.toContain('pr0:');
    expect(query).not.toContain('fragment');
  });
});
