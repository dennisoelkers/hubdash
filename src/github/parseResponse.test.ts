import { describe, expect, it } from 'vitest';
import type { TrackedTask } from '../types';
import { parseResponse } from './parseResponse';

const prs: TrackedTask[] = [
  {
    kind: 'pr',
    owner: 'Example',
    repo: 'example-server',
    number: 4821,
    addedAt: '2026-08-27T09:00:00Z',
  },
];

function rollup(state: string, nodes: unknown[] = []) {
  return {
    state,
    contexts: { totalCount: nodes.length, nodes },
  };
}

function prNode(overrides: Record<string, unknown> = {}, rollupValue: unknown = rollup('SUCCESS')) {
  return {
    number: 4821,
    title: 'Fix index rotation',
    url: 'https://github.com/Example/example-server/pull/4821',
    state: 'OPEN',
    isDraft: false,
    updatedAt: '2026-08-27T10:00:00Z',
    author: { login: 'octocat' },
    baseRefName: 'master',
    repository: { nameWithOwner: 'Example/example-server' },
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable: 'MERGEABLE',
    reviewRequests: { totalCount: 0 },
    latestReviews: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: rollupValue } }] },
    ...overrides,
  };
}

function issueNode(overrides: Record<string, unknown> = {}) {
  return {
    number: 55,
    title: 'Sort order is wrong on empty input',
    url: 'https://github.com/Example/example-server/issues/55',
    state: 'OPEN',
    updatedAt: '2026-08-27T10:00:00Z',
    author: { login: 'octocat' },
    repository: { nameWithOwner: 'Example/example-server' },
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}, errors?: unknown[]) {
  return {
    data: {
      rateLimit: { limit: 5000, cost: 1, remaining: 4812, resetAt: '2026-08-27T11:00:00Z' },
      pr0: { pullRequest: prNode() },
      ...overrides,
    },
    ...(errors ? { errors } : {}),
  };
}

function parseOk(raw: unknown, tracked: TrackedTask[] = prs) {
  const result = parseResponse(raw, tracked);
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return result.result;
}

describe('parseResponse — happy path', () => {
  it('normalises a PR', () => {
    const { entries, issueEntries } = parseOk(response());
    expect(entries).toHaveLength(1);
    expect(issueEntries).toHaveLength(0);
    const entry = entries[0];
    if (entry?.status !== 'ok') throw new Error('expected an ok entry');
    expect(entry.pr).toMatchObject({
      key: 'example/example-server#4821',
      owner: 'Example',
      repo: 'example-server',
      number: 4821,
      title: 'Fix index rotation',
      author: 'octocat',
      nameWithOwner: 'Example/example-server',
      baseRefName: 'master',
      lifecycle: 'OPEN',
      isDraft: false,
      reviewDecision: 'REVIEW_REQUIRED',
      mergeable: 'MERGEABLE',
      ci: 'success',
      failingCheckCount: 0,
      approvalCount: 0,
      requestedReviewerCount: 0,
    });
    // PrEntry.tracked stays exactly TrackedPr-shaped — no `kind` leaks in.
    expect(entry.tracked).toEqual({
      owner: 'Example',
      repo: 'example-server',
      number: 4821,
      addedAt: '2026-08-27T09:00:00Z',
    });
  });

  it('reads the rate limit', () => {
    expect(parseOk(response()).rateLimit).toEqual({
      limit: 5000,
      cost: 1,
      remaining: 4812,
      resetAt: '2026-08-27T11:00:00Z',
    });
  });

  it('tolerates a missing rate limit', () => {
    expect(parseOk(response({ rateLimit: null })).rateLimit).toBeNull();
  });

  it('counts approvals from latestReviews', () => {
    const raw = response({
      pr0: {
        pullRequest: prNode({
          latestReviews: {
            nodes: [{ state: 'APPROVED' }, { state: 'COMMENTED' }, { state: 'APPROVED' }],
          },
        }),
      },
    });
    const entry = parseOk(raw).entries[0];
    if (entry?.status !== 'ok') throw new Error('expected an ok entry');
    expect(entry.pr.approvalCount).toBe(2);
  });

  it('reads the requested reviewer count', () => {
    const raw = response({ pr0: { pullRequest: prNode({ reviewRequests: { totalCount: 3 } }) } });
    const entry = parseOk(raw).entries[0];
    if (entry?.status !== 'ok') throw new Error('expected an ok entry');
    expect(entry.pr.requestedReviewerCount).toBe(3);
  });
});

describe('parseResponse — CI normalisation', () => {
  function ciOf(rollupValue: unknown) {
    const entry = parseOk(response({ pr0: { pullRequest: prNode({}, rollupValue) } })).entries[0];
    if (entry?.status !== 'ok') throw new Error('expected an ok entry');
    return { ci: entry.pr.ci, failing: entry.pr.failingCheckCount };
  }

  it('maps a null rollup to "none", not to a failure', () => {
    expect(ciOf(null).ci).toBe('none');
  });

  it('maps an absent commits list to "none"', () => {
    const raw = response({ pr0: { pullRequest: prNode({ commits: { nodes: [] } }) } });
    const entry = parseOk(raw).entries[0];
    if (entry?.status !== 'ok') throw new Error('expected an ok entry');
    expect(entry.pr.ci).toBe('none');
  });

  it('maps SUCCESS, FAILURE, ERROR, PENDING and EXPECTED', () => {
    expect(ciOf(rollup('SUCCESS')).ci).toBe('success');
    expect(ciOf(rollup('FAILURE')).ci).toBe('failure');
    expect(ciOf(rollup('ERROR')).ci).toBe('failure');
    expect(ciOf(rollup('PENDING')).ci).toBe('pending');
    expect(ciOf(rollup('EXPECTED')).ci).toBe('pending');
  });

  it('maps an unrecognised rollup state to pending rather than green or red', () => {
    expect(ciOf(rollup('SOMETHING_NEW')).ci).toBe('pending');
  });

  it('counts failing check runs and status contexts', () => {
    const nodes = [
      { __typename: 'CheckRun', name: 'unit', conclusion: 'FAILURE', status: 'COMPLETED' },
      { __typename: 'CheckRun', name: 'lint', conclusion: 'TIMED_OUT', status: 'COMPLETED' },
      { __typename: 'CheckRun', name: 'ok', conclusion: 'SUCCESS', status: 'COMPLETED' },
      { __typename: 'CheckRun', name: 'skipped', conclusion: 'SKIPPED', status: 'COMPLETED' },
      { __typename: 'StatusContext', context: 'ci/legacy', state: 'FAILURE' },
      { __typename: 'StatusContext', context: 'ci/other', state: 'SUCCESS' },
    ];
    expect(ciOf(rollup('FAILURE', nodes))).toEqual({ ci: 'failure', failing: 3 });
  });

  it('does not count a neutral or skipped conclusion as failing', () => {
    const nodes = [
      { __typename: 'CheckRun', name: 'n', conclusion: 'NEUTRAL', status: 'COMPLETED' },
      { __typename: 'CheckRun', name: 's', conclusion: 'SKIPPED', status: 'COMPLETED' },
    ];
    expect(ciOf(rollup('SUCCESS', nodes)).failing).toBe(0);
  });

  it('reports a red rollup with no visible failing context as failing with a zero count', () => {
    expect(ciOf(rollup('FAILURE', []))).toEqual({ ci: 'failure', failing: 0 });
  });
});

describe('parseResponse — per-PR failures', () => {
  it('marks a PR errored when its alias came back null', () => {
    const entry = parseOk(response({ pr0: null })).entries[0];
    if (entry?.status !== 'error') throw new Error('expected an error entry');
    expect(entry.key).toBe('example/example-server#4821');
    expect(entry.message).toBeTruthy();
  });

  it('marks a PR errored when the repository resolved but the PR did not', () => {
    const entry = parseOk(response({ pr0: { pullRequest: null } })).entries[0];
    expect(entry?.status).toBe('error');
  });

  it('uses the GraphQL error message when one names the alias', () => {
    const raw = response({ pr0: null }, [
      { message: 'Could not resolve to a Repository with the name.', path: ['pr0'] },
    ]);
    const entry = parseOk(raw).entries[0];
    if (entry?.status !== 'error') throw new Error('expected an error entry');
    expect(entry.message).toBe('Could not resolve to a Repository with the name.');
  });

  it('lets healthy PRs through when a sibling fails', () => {
    const two: TrackedTask[] = [
      ...prs,
      { kind: 'pr', owner: 'Example', repo: 'gone', number: 1, addedAt: '2026-08-27T09:00:00Z' },
    ];
    const raw = response({ pr1: null }, [{ message: 'Not found', path: ['pr1'] }]);
    const { entries } = parseOk(raw, two);
    expect(entries[0]?.status).toBe('ok');
    expect(entries[1]?.status).toBe('error');
  });

  it('returns one entry per tracked PR, in tracked order', () => {
    const two: TrackedTask[] = [
      ...prs,
      { kind: 'pr', owner: 'Example', repo: 'other', number: 7, addedAt: '2026-08-27T09:00:00Z' },
    ];
    const { entries } = parseOk(response(), two);
    expect(entries.map((entry) => entry.tracked.number)).toEqual([4821, 7]);
  });
});

describe('parseResponse — issues', () => {
  const issueTarget: TrackedTask = {
    kind: 'issue',
    owner: 'Example',
    repo: 'example-server',
    number: 55,
    addedAt: '2026-08-27T09:00:00Z',
  };

  it('normalises an issue into issueEntries, not entries', () => {
    const raw = response({ pr0: { issue: issueNode() } });
    const { entries, issueEntries } = parseOk(raw, [issueTarget]);
    expect(entries).toHaveLength(0);
    expect(issueEntries).toHaveLength(1);
    const entry = issueEntries[0];
    if (entry?.status !== 'ok') throw new Error('expected an ok entry');
    expect(entry.issue).toEqual({
      key: 'example/example-server#55',
      owner: 'Example',
      repo: 'example-server',
      number: 55,
      title: 'Sort order is wrong on empty input',
      url: 'https://github.com/Example/example-server/issues/55',
      author: 'octocat',
      nameWithOwner: 'Example/example-server',
      updatedAt: '2026-08-27T10:00:00Z',
      lifecycle: 'OPEN',
    });
  });

  it('maps a CLOSED issue state to lifecycle CLOSED', () => {
    const raw = response({ pr0: { issue: issueNode({ state: 'CLOSED' }) } });
    const entry = parseOk(raw, [issueTarget]).issueEntries[0];
    if (entry?.status !== 'ok') throw new Error('expected an ok entry');
    expect(entry.issue.lifecycle).toBe('CLOSED');
  });

  it('marks an issue errored when its alias came back null', () => {
    const raw = response({ pr0: null });
    const entry = parseOk(raw, [issueTarget]).issueEntries[0];
    if (entry?.status !== 'error') throw new Error('expected an error entry');
    expect(entry.message).toBeTruthy();
  });

  it('marks an issue errored when the repository resolved but the issue did not', () => {
    const raw = response({ pr0: { issue: null } });
    const entry = parseOk(raw, [issueTarget]).issueEntries[0];
    expect(entry?.status).toBe('error');
  });

  it('splits a mixed pr+issue response into the two arrays, in tracked order', () => {
    const raw = response({ pr0: { pullRequest: prNode() }, pr1: { issue: issueNode() } });
    const { entries, issueEntries } = parseOk(raw, [...prs, issueTarget]);
    expect(entries).toHaveLength(1);
    expect(issueEntries).toHaveLength(1);
    expect(entries[0]?.key).toBe('example/example-server#4821');
    expect(issueEntries[0]?.key).toBe('example/example-server#55');
  });
});

describe('parseResponse — malformed payloads', () => {
  it('fails when there is no data object', () => {
    expect(parseResponse({ errors: [{ message: 'Bad credentials' }] }, prs).ok).toBe(false);
    expect(parseResponse({}, prs).ok).toBe(false);
    expect(parseResponse(null, prs).ok).toBe(false);
    expect(parseResponse('nonsense', prs).ok).toBe(false);
  });

  it('surfaces the first top-level error message when data is absent', () => {
    const result = parseResponse({ errors: [{ message: 'Bad credentials' }] }, prs);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('Bad credentials');
  });

  it('marks a PR errored rather than failing the poll when its node is not an object', () => {
    const entry = parseOk(response({ pr0: { pullRequest: 42 } })).entries[0];
    expect(entry?.status).toBe('error');
  });
});
