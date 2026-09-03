import { describe, expect, it } from 'vitest';
import type { TrackedTask } from '../types';
import { aliasFor, buildQuery } from './buildQuery';

const prs: TrackedTask[] = [
  {
    kind: 'pr',
    owner: 'Example',
    repo: 'example-server',
    number: 4821,
    addedAt: '2026-08-27T09:00:00Z',
  },
  {
    kind: 'pr',
    owner: 'Example',
    repo: 'example-plugin-enterprise',
    number: 912,
    addedAt: '2026-08-27T09:00:00Z',
  },
];

describe('aliasFor', () => {
  it('names the nth aliased field', () => {
    expect(aliasFor(0)).toBe('pr0');
    expect(aliasFor(12)).toBe('pr12');
  });
});

describe('buildQuery — pull requests', () => {
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

  it('declares the PR fragment exactly once no matter how many PRs', () => {
    const occurrences = buildQuery(prs).match(/fragment prFields on PullRequest/g);
    expect(occurrences).toHaveLength(1);
  });

  it('does not declare the issue fragment when nothing tracked is an issue', () => {
    expect(buildQuery(prs)).not.toContain('fragment issueFields on Issue');
  });

  it('escapes owner and repo so a crafted name cannot break out of the string', () => {
    const query = buildQuery([
      { kind: 'pr', owner: 'a"b', repo: 'c\\d', number: 1, addedAt: '2026-08-27T09:00:00Z' },
    ]);
    expect(query).toContain('owner: "a\\"b"');
    expect(query).toContain('name: "c\\\\d"');
  });

  it('produces a valid query with no targets', () => {
    const query = buildQuery([]);
    expect(query).toContain('rateLimit');
    expect(query).not.toContain('pr0:');
    expect(query).not.toContain('fragment');
  });
});

describe('buildQuery — issues', () => {
  const issues: TrackedTask[] = [
    {
      kind: 'issue',
      owner: 'Example',
      repo: 'example-server',
      number: 55,
      addedAt: '2026-08-27T09:00:00Z',
    },
  ];

  it('aliases an issue-kind target to the issue field, not pullRequest', () => {
    const query = buildQuery(issues);
    expect(query).toContain('pr0: repository(owner: "Example", name: "example-server")');
    expect(query).toContain('issue(number: 55)');
    expect(query).not.toContain('pullRequest(number: 55)');
  });

  it('declares only the issue fragment when nothing tracked is a PR', () => {
    const query = buildQuery(issues);
    expect(query).toContain('fragment issueFields on Issue');
    expect(query).not.toContain('fragment prFields on PullRequest');
  });

  it('includes the fields the issue normaliser needs', () => {
    const query = buildQuery(issues);
    for (const field of ['title', 'url', 'state', 'updatedAt']) {
      expect(query, field).toContain(field);
    }
  });

  it('declares both fragments exactly once each for a mixed pr+issue query', () => {
    const query = buildQuery([...prs, ...issues]);
    expect(query.match(/fragment prFields on PullRequest/g)).toHaveLength(1);
    expect(query.match(/fragment issueFields on Issue/g)).toHaveLength(1);
    expect(query).toContain('pr2: repository(owner: "Example", name: "example-server")');
    expect(query).toContain('issue(number: 55)');
  });
});
