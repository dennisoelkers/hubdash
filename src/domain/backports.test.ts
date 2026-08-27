import { describe, expect, it } from 'vitest';
import { makePr } from '../test/makePr';
import type { BackportGroup, BackportSlot, PrEntry, PrKey, TrackedPr } from '../types';
import { prKey } from './prKey';
import {
  groupKey,
  groupPrs,
  isComplete,
  orderGroups,
  prStateFor,
  rollUpFor,
  slotStateFor,
} from './backports';

function tracked(number: number): TrackedPr {
  return { owner: 'Graylog2', repo: 'graylog2-server', number, addedAt: '2026-08-01T00:00:00Z' };
}

function keyOf(number: number): PrKey {
  return prKey('Graylog2', 'graylog2-server', number);
}

/** An entry map holding one ok entry per given (number, lifecycle) pair. */
function entryMap(...specs: Array<[number, 'OPEN' | 'CLOSED' | 'MERGED']>): Map<PrKey, PrEntry> {
  const map = new Map<PrKey, PrEntry>();
  for (const [number, lifecycle] of specs) {
    const pr = makePr({ number, lifecycle });
    map.set(pr.key, { status: 'ok', key: pr.key, tracked: tracked(number), pr });
  }
  return map;
}

function slot(version: string, number: number | null): BackportSlot {
  return { version, pr: number === null ? null : tracked(number) };
}

function group(overrides: Partial<BackportGroup> = {}): BackportGroup {
  return {
    main: tracked(4821),
    slots: [slot('6.2', 4840), slot('6.1', 4841), slot('6.0', null)],
    addedAt: '2026-08-20T00:00:00Z',
    ...overrides,
  };
}

describe('groupKey', () => {
  it('is the main PR key, so a group needs no generated id', () => {
    expect(groupKey(group())).toBe('graylog2/graylog2-server#4821');
  });
});

describe('groupPrs', () => {
  it('returns the main PR and every filled slot, skipping empty ones', () => {
    expect(groupPrs(group()).map((pr) => pr.number)).toEqual([4821, 4840, 4841]);
  });

  it('returns just the main PR when no slot is filled', () => {
    const g = group({ slots: [slot('6.2', null), slot('6.1', null)] });
    expect(groupPrs(g).map((pr) => pr.number)).toEqual([4821]);
  });

  it('returns just the main PR for a group with no versions', () => {
    expect(groupPrs(group({ slots: [] })).map((pr) => pr.number)).toEqual([4821]);
  });
});

describe('prStateFor', () => {
  it('is empty for null, merged/open/closed/pending/errored for a real PR — the same table slotStateFor uses', () => {
    expect(prStateFor(null, entryMap())).toEqual({ kind: 'empty' });
    expect(prStateFor(tracked(1), entryMap())).toEqual({ kind: 'pending' });
    expect(prStateFor(tracked(1), entryMap([1, 'MERGED']))).toEqual({ kind: 'merged' });
  });
});

describe('slotStateFor', () => {
  it('is empty when the slot has no PR', () => {
    expect(slotStateFor(slot('6.0', null), entryMap())).toEqual({ kind: 'empty' });
  });

  it('is pending when a PR is set but no entry has arrived', () => {
    // Claiming `open` here would assert something we do not know — the PR may
    // already be merged and simply not polled yet.
    expect(slotStateFor(slot('6.2', 4840), entryMap())).toEqual({ kind: 'pending' });
  });

  it('is merged, open and closed from the entry lifecycle', () => {
    expect(slotStateFor(slot('a', 1), entryMap([1, 'MERGED']))).toEqual({ kind: 'merged' });
    expect(slotStateFor(slot('a', 1), entryMap([1, 'OPEN']))).toEqual({ kind: 'open' });
    expect(slotStateFor(slot('a', 1), entryMap([1, 'CLOSED']))).toEqual({ kind: 'closed' });
  });

  it('is errored, carrying the message, when the PR did not resolve', () => {
    const map = new Map<PrKey, PrEntry>([
      [keyOf(4840), { status: 'error', key: keyOf(4840), tracked: tracked(4840), message: 'Not found' }],
    ]);
    expect(slotStateFor(slot('6.2', 4840), map)).toEqual({ kind: 'errored', message: 'Not found' });
  });
});

describe('rollUpFor', () => {
  it('counts merged slots over total slots', () => {
    expect(rollUpFor(group(), entryMap([4840, 'MERGED'], [4841, 'OPEN']))).toEqual({
      landed: 1,
      total: 3,
    });
  });

  it('excludes the main PR from both numbers', () => {
    // Main is the thing being backported, not a backport. The default fixture
    // has one null (6.0) slot, so even with main merged, at most 2 of its 3
    // slots can resolve to merged — {2,3}, never {3,3} or {3,4}. A buggy
    // implementation that folded main into either count would report a
    // different pair than this.
    const roll = rollUpFor(group(), entryMap([4821, 'MERGED'], [4840, 'MERGED'], [4841, 'MERGED']));
    expect(roll).toEqual({ landed: 2, total: 3 });
  });

  it('counts an empty, pending, closed or errored slot toward the total but not landed', () => {
    const g = group({ slots: [slot('a', null), slot('b', 1), slot('c', 2)] });
    expect(rollUpFor(g, entryMap([2, 'CLOSED']))).toEqual({ landed: 0, total: 3 });
  });

  it('is zero of zero for a group with no versions', () => {
    expect(rollUpFor(group({ slots: [] }), entryMap())).toEqual({ landed: 0, total: 0 });
  });
});

describe('isComplete', () => {
  it('is true only when every slot has merged', () => {
    const g = group({ slots: [slot('a', 1), slot('b', 2)] });
    expect(isComplete(g, entryMap([1, 'MERGED'], [2, 'MERGED']))).toBe(true);
    expect(isComplete(g, entryMap([1, 'MERGED'], [2, 'OPEN']))).toBe(false);
  });

  it('is false for a group with no versions', () => {
    // Nothing has landed because nothing was asked for; treating this as done
    // would hide a group the user is still setting up.
    expect(isComplete(group({ slots: [] }), entryMap())).toBe(false);
  });

  it('ignores the main PR', () => {
    const g = group({ slots: [slot('a', 1)] });
    expect(isComplete(g, entryMap([1, 'MERGED']))).toBe(true);
  });
});

describe('orderGroups', () => {
  function named(mainNumber: number, addedAt: string, slots: BackportSlot[]): BackportGroup {
    return { main: tracked(mainNumber), slots, addedAt };
  }

  it('puts incomplete groups before complete ones', () => {
    const done = named(1, '2026-08-01T00:00:00Z', [slot('a', 10)]);
    const notDone = named(2, '2026-07-01T00:00:00Z', [slot('a', 20)]);
    const ordered = orderGroups([done, notDone], entryMap([10, 'MERGED'], [20, 'OPEN']));
    // The older incomplete group still outranks the newer finished one.
    expect(ordered.map((g) => g.main.number)).toEqual([2, 1]);
  });

  it('orders by addedAt descending within each half', () => {
    const a = named(1, '2026-08-01T00:00:00Z', [slot('v', 10)]);
    const b = named(2, '2026-08-20T00:00:00Z', [slot('v', 20)]);
    const ordered = orderGroups([a, b], entryMap([10, 'OPEN'], [20, 'OPEN']));
    expect(ordered.map((g) => g.main.number)).toEqual([2, 1]);
  });

  it('does not mutate the input array', () => {
    const groups = [named(1, '2026-08-01T00:00:00Z', []), named(2, '2026-08-20T00:00:00Z', [])];
    orderGroups(groups, entryMap());
    expect(groups.map((g) => g.main.number)).toEqual([1, 2]);
  });
});
