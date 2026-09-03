import { describe, expect, it } from 'vitest';
import { makePr } from '../test/makePr';
import type { IssueEntry, NormalisedIssue, PrEntry } from '../types';
import { taskStatusFor } from './taskStatus';

function okPrEntry(overrides: Parameters<typeof makePr>[0] = {}): PrEntry {
  const pr = makePr(overrides);
  return { status: 'ok', key: pr.key, tracked: { ...pr, addedAt: pr.updatedAt }, pr };
}

function makeIssue(overrides: Partial<NormalisedIssue> = {}): NormalisedIssue {
  return {
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
    ...overrides,
  };
}

function okIssueEntry(overrides: Partial<NormalisedIssue> = {}): IssueEntry {
  const issue = makeIssue(overrides);
  return {
    status: 'ok',
    key: issue.key,
    tracked: {
      kind: 'issue',
      owner: issue.owner,
      repo: issue.repo,
      number: issue.number,
      addedAt: issue.updatedAt,
    },
    issue,
  };
}

describe('taskStatusFor — no data yet', () => {
  it('reports pending when the entry is undefined', () => {
    expect(taskStatusFor(undefined)).toEqual({ kind: 'pending' });
  });
});

describe('taskStatusFor — errored entries', () => {
  it('carries the message through for an errored PR entry', () => {
    const entry: PrEntry = {
      status: 'error',
      key: 'example/example-server#4821',
      tracked: {
        owner: 'Example',
        repo: 'example-server',
        number: 4821,
        addedAt: '2026-08-27T09:00:00Z',
      },
      message: 'This pull request could not be loaded.',
    };
    expect(taskStatusFor(entry)).toEqual({
      kind: 'errored',
      message: 'This pull request could not be loaded.',
    });
  });

  it('carries the message through for an errored issue entry', () => {
    const entry: IssueEntry = {
      status: 'error',
      key: 'example/example-server#55',
      tracked: {
        kind: 'issue',
        owner: 'Example',
        repo: 'example-server',
        number: 55,
        addedAt: '2026-08-27T09:00:00Z',
      },
      message: 'This issue could not be loaded.',
    };
    expect(taskStatusFor(entry)).toEqual({ kind: 'errored', message: 'This issue could not be loaded.' });
  });
});

describe('taskStatusFor — PR entries reuse classify()', () => {
  it('reports merged for a merged PR, not classify()’s archive bucket', () => {
    expect(taskStatusFor(okPrEntry({ lifecycle: 'MERGED' }))).toEqual({ kind: 'merged' });
  });

  it('reports closed for a closed, unmerged PR', () => {
    expect(taskStatusFor(okPrEntry({ lifecycle: 'CLOSED' }))).toEqual({ kind: 'closed' });
  });

  it('reports needsAction for an open PR with changes requested', () => {
    expect(
      taskStatusFor(okPrEntry({ reviewDecision: 'CHANGES_REQUESTED', requestedReviewerCount: 0 })),
    ).toEqual({ kind: 'needsAction' });
  });

  it('reports ready for an approved, green PR', () => {
    expect(taskStatusFor(okPrEntry({ reviewDecision: 'APPROVED', ci: 'success' }))).toEqual({
      kind: 'ready',
    });
  });

  it('reports waiting for an unreviewed PR', () => {
    expect(taskStatusFor(okPrEntry())).toEqual({ kind: 'waiting' });
  });
});

describe('taskStatusFor — issue entries use classifyIssue()', () => {
  it('reports waiting for an open issue', () => {
    expect(taskStatusFor(okIssueEntry({ lifecycle: 'OPEN' }))).toEqual({ kind: 'waiting' });
  });

  it('reports closed for a closed issue', () => {
    expect(taskStatusFor(okIssueEntry({ lifecycle: 'CLOSED' }))).toEqual({ kind: 'closed' });
  });
});
