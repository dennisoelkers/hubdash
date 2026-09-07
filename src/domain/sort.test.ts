import { describe, expect, it } from 'vitest';
import { makePr } from '../test/makePr';
import type { PrEntry, TrackedPr } from '../types';
import { groupIntoColumns } from './sort';

const tracked: TrackedPr = {
  owner: 'Example',
  repo: 'example-server',
  number: 1,
  addedAt: '2026-08-01T00:00:00Z',
};

function ok(overrides: Parameters<typeof makePr>[0]): PrEntry {
  const pr = makePr(overrides);
  return { status: 'ok', key: pr.key, tracked: { ...tracked, number: pr.number }, pr };
}

function errored(number: number, message = 'Not found'): PrEntry {
  return {
    status: 'error',
    key: `example/example-server#${number}`,
    tracked: { ...tracked, number },
    message,
  };
}

function numbersIn(entries: PrEntry[]): number[] {
  return entries.map((entry) => entry.tracked.number);
}

describe('groupIntoColumns', () => {
  it('returns all four columns even when empty', () => {
    const columns = groupIntoColumns([]);
    expect(Object.keys(columns).sort()).toEqual(['archive', 'needsAction', 'ready', 'waiting']);
    expect(columns.waiting).toEqual([]);
  });

  it('places each entry in the column classify chooses', () => {
    const columns = groupIntoColumns([
      ok({ number: 1 }),
      ok({ number: 2, ci: 'failure' }),
      ok({ number: 3, reviewDecision: 'APPROVED' }),
      ok({ number: 4, lifecycle: 'MERGED' }),
    ]);
    expect(numbersIn(columns.waiting)).toEqual([1]);
    expect(numbersIn(columns.needsAction)).toEqual([2]);
    expect(numbersIn(columns.ready)).toEqual([3]);
    expect(numbersIn(columns.archive)).toEqual([4]);
  });

  it('orders by updatedAt, most recent first', () => {
    const columns = groupIntoColumns([
      ok({ number: 1, updatedAt: '2026-08-20T00:00:00Z' }),
      ok({ number: 2, updatedAt: '2026-08-27T00:00:00Z' }),
      ok({ number: 3, updatedAt: '2026-08-24T00:00:00Z' }),
    ]);
    expect(numbersIn(columns.waiting)).toEqual([2, 3, 1]);
  });

  it('sorts drafts below everything else in needs action', () => {
    const columns = groupIntoColumns([
      ok({ number: 1, isDraft: true, updatedAt: '2026-08-27T00:00:00Z' }),
      ok({ number: 2, ci: 'failure', updatedAt: '2026-08-01T00:00:00Z' }),
    ]);
    // The draft is newer but must still sit below the broken build.
    expect(numbersIn(columns.needsAction)).toEqual([2, 1]);
  });

  it('orders drafts among themselves by updatedAt', () => {
    const columns = groupIntoColumns([
      ok({ number: 1, isDraft: true, updatedAt: '2026-08-01T00:00:00Z' }),
      ok({ number: 2, isDraft: true, updatedAt: '2026-08-27T00:00:00Z' }),
    ]);
    expect(numbersIn(columns.needsAction)).toEqual([2, 1]);
  });

  it('puts errored entries at the top of needs action', () => {
    // A PR that cannot be resolved needs a decision from the user — usually
    // removing it — so it belongs with the other things that need action.
    const columns = groupIntoColumns([
      ok({ number: 1, ci: 'failure' }),
      errored(99),
      ok({ number: 2, isDraft: true }),
    ]);
    expect(numbersIn(columns.needsAction)).toEqual([99, 1, 2]);
  });
});

describe('groupIntoColumns — manually archived PRs', () => {
  it('sends a manually-archived, still-open PR to archive ahead of classify()', () => {
    const entry = ok({ number: 1 }); // open, unreviewed — classify() would say waiting
    const columns = groupIntoColumns([entry], new Set([entry.key]));
    expect(numbersIn(columns.archive)).toEqual([1]);
    expect(numbersIn(columns.waiting)).toEqual([]);
  });

  it('keeps an archived PR in archive even if it later errors', () => {
    const entry = errored(1);
    const columns = groupIntoColumns([entry], new Set([entry.key]));
    expect(numbersIn(columns.archive)).toEqual([1]);
    expect(numbersIn(columns.needsAction)).toEqual([]);
  });

  it('does not affect a PR that was not manually archived', () => {
    const columns = groupIntoColumns([ok({ number: 1 })], new Set(['example/example-server#999']));
    expect(numbersIn(columns.waiting)).toEqual([1]);
  });

  it('leaves merged/closed PRs archived exactly as before, with no set at all', () => {
    const columns = groupIntoColumns([ok({ number: 1, lifecycle: 'MERGED' })]);
    expect(numbersIn(columns.archive)).toEqual([1]);
  });
});
