# Backports Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second tab that tracks whether a change has landed everywhere it needs to — one main PR plus a slot per target version, showing merge status only.

**Architecture:** A new `hubdash.backports` key holds groups, independent of the board's `hubdash.prs`. All status derives from `NormalisedPr.lifecycle`, which the existing query already fetches, so `buildQuery` and `parseResponse` are untouched. `App` polls the deduplicated union of both tabs' PRs, preserving one request per poll. Two refactors are included because this work makes them necessary: extracting the shared `localStorage` guards, and moving the board's rendering out of `App` into a `BoardTab` sibling.

**Tech Stack:** Vite 6, React 19, TypeScript 5.7 (strict), styled-components 6, Vitest 3 + Testing Library, jsdom. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-backports-tab-design.md` (extends `2026-08-27-hubdash-design.md`)

## Global Constraints

Every task's requirements implicitly include this section.

- **No backend, no build-time secrets.** Static build only. No new dependencies.
- **No write operations against GitHub.** Every request is a read.
- **`localStorage` holds identity only, never status.** Persisted keys are `hubdash.token`, `hubdash.prs`, and now `hubdash.backports`, each with an optional `.corrupt` backup. A group stores which PRs and which version labels — never a merge state.
- **One GraphQL request per poll**, regardless of how many PRs are tracked across both tabs.
- **Poll interval is 15000 ms.** Polling pauses while `document.hidden`, never overlaps itself, and coalesces a blocked call into exactly one follow-up.
- **The token is never logged and never rendered unmasked.**
- **A malformed `localStorage` value must never throw to the UI** — it is reported once and the unusable value is preserved under its `.corrupt` key.
- **Merge status only on this tab.** `classify`, `badgesFor` and `groupIntoColumns` must not be imported by any new module.
- TypeScript strict, plus `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`. **No `any`, no non-null assertions (`!`), and no `as SomeType` cast used to sidestep `noUncheckedIndexedAccess`** — narrow honestly.
- **Test output must be pristine**: no `act()` warnings, no unhandled rejections, no styled-components warnings.
- Every pure module gets its tests written before its implementation.
- Commit after every task with a `feat:` / `fix:` / `test:` / `refactor:` / `docs:` prefix.

## Baseline

The suite is at **240 tests across 20 files** before this plan starts. Every task must leave it green, and the two refactor tasks (3 and 6) must leave the count *unchanged* — they alter structure, not behaviour.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/types.ts` | **modify** — add `BackportSlot`, `BackportGroup`, `SlotState` |
| `src/domain/parseVersions.ts` | Comma-separated string → ordered unique version labels |
| `src/domain/backports.ts` | Slot state, roll-up, completeness, group ordering, a group's pollable PRs |
| `src/storage/localStorage.ts` | **new** — the throw-guarded storage access all three stores share |
| `src/storage/trackedPrs.ts` | **modify** — use the shared guards |
| `src/storage/token.ts` | **modify** — use the shared guards, dropping its odd import from `trackedPrs` |
| `src/storage/backportGroups.ts` | Validating load/save for `hubdash.backports` |
| `src/hooks/useBackportGroups.ts` | Group state, persistence, and every mutation |
| `src/ui/TabBar.tsx` | Two tabs with counts |
| `src/ui/SlotRow.tsx` | One version row: state, link, drop target, inline URL input |
| `src/ui/BackportGroupCard.tsx` | Group header, roll-up, main row, slot rows, add-version |
| `src/ui/AddBackportGroupDialog.tsx` | Main PR URL + comma-separated versions |
| `src/ui/BackportsTab.tsx` | Ordered group list and empty states |
| `src/ui/BoardTab.tsx` | **new** — the board's rendering, extracted from `App` |
| `src/ui/App.tsx` | **modify** — tab state, union poll targets, per-tab drop behaviour |

---

### Task 1: Types and `parseVersions`

**Files:**
- Modify: `src/types.ts`
- Create: `src/domain/parseVersions.ts`
- Test: `src/domain/parseVersions.test.ts`

**Interfaces:**
- Consumes: `TrackedPr` (existing, in `src/types.ts`).
- Produces:
  ```ts
  // src/types.ts
  export type BackportSlot = { version: string; pr: TrackedPr | null };
  export type BackportGroup = { main: TrackedPr; slots: BackportSlot[]; addedAt: string };
  export type SlotState =
    | { kind: 'empty' }
    | { kind: 'pending' }
    | { kind: 'errored'; message: string }
    | { kind: 'open' }
    | { kind: 'merged' }
    | { kind: 'closed' };

  // src/domain/parseVersions.ts
  export function parseVersions(input: string): string[];
  ```

- [ ] **Step 1: Add the three types to `src/types.ts`**

Append these after the existing `TrackedPr` block. The names are consumed verbatim by every later task.

```ts
/** One target version of a backport group, and the PR filling it (if any). */
export type BackportSlot = {
  /** Free-text version label exactly as the user typed it, e.g. "6.2". */
  version: string;
  /** The backport PR filling this slot, or null while the slot is empty. */
  pr: TrackedPr | null;
};

/**
 * A change and everywhere it still has to land. Identified by its main PR's
 * `prKey` — there is no generated id, so identity follows the codebase's one
 * canonical key format and duplicate detection comes for free.
 */
export type BackportGroup = {
  main: TrackedPr;
  slots: BackportSlot[];
  /** ISO 8601, when the group was created. */
  addedAt: string;
};

/**
 * Merge status of one slot. This tab tracks nothing else — no CI, no review.
 * `pending` means a PR is set but no poll has returned for it yet; claiming
 * `open` there would assert something we do not know.
 */
export type SlotState =
  | { kind: 'empty' }
  | { kind: 'pending' }
  | { kind: 'errored'; message: string }
  | { kind: 'open' }
  | { kind: 'merged' }
  | { kind: 'closed' };
```

- [ ] **Step 2: Write the failing tests**

`src/domain/parseVersions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseVersions } from './parseVersions';

describe('parseVersions', () => {
  it('splits a comma-separated list', () => {
    expect(parseVersions('6.2,6.1,6.0')).toEqual(['6.2', '6.1', '6.0']);
  });

  it('trims surrounding whitespace on each part', () => {
    expect(parseVersions(' 6.2 ,  6.1,6.0 ')).toEqual(['6.2', '6.1', '6.0']);
  });

  it('drops empty parts rather than producing blank versions', () => {
    expect(parseVersions('6.2,,6.1,')).toEqual(['6.2', '6.1']);
  });

  it('removes duplicates, keeping the first occurrence', () => {
    expect(parseVersions('6.2,6.1,6.2')).toEqual(['6.2', '6.1']);
  });

  it('preserves the order given rather than sorting', () => {
    // Version schemes vary; a wrong sort is worse than the user's own order.
    expect(parseVersions('5.2, 6.0, 6.1')).toEqual(['5.2', '6.0', '6.1']);
  });

  it('returns an empty list for input that parses to nothing', () => {
    expect(parseVersions('')).toEqual([]);
    expect(parseVersions('   ')).toEqual([]);
    expect(parseVersions(',,,')).toEqual([]);
  });

  it('accepts labels that are not dotted numbers', () => {
    expect(parseVersions('main, release/6.2, hotfix')).toEqual([
      'main',
      'release/6.2',
      'hotfix',
    ]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run src/domain/parseVersions.test.ts
```

Expected: FAIL — `Failed to resolve import "./parseVersions"`.

- [ ] **Step 4: Implement `src/domain/parseVersions.ts`**

```ts
/**
 * Parses the dialog's comma-separated version field into ordered unique labels.
 *
 * Labels stay free text and stay in the order given: version schemes vary
 * between projects, so sorting them risks presenting a wrong order confidently
 * where the user's own order was already right.
 */
export function parseVersions(input: string): string[] {
  const seen = new Set<string>();
  const versions: string[] = [];

  for (const part of input.split(',')) {
    const version = part.trim();
    if (version === '' || seen.has(version)) continue;
    seen.add(version);
    versions.push(version);
  }

  return versions;
}
```

- [ ] **Step 5: Run the tests and the typecheck**

```bash
npx vitest run src/domain/parseVersions.test.ts
npm run typecheck
```

Expected: 7 tests pass, typecheck clean.

- [ ] **Step 6: Run the full suite**

```bash
npx vitest run
```

Expected: 247 passing (240 baseline + 7).

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/domain/parseVersions.ts src/domain/parseVersions.test.ts
git commit -m "feat: add backport group types and version-list parsing"
```

---

### Task 2: `domain/backports.ts`

The tab's whole decision layer, and the only place merge status is derived.

**Files:**
- Create: `src/domain/backports.ts`
- Test: `src/domain/backports.test.ts`

**Interfaces:**
- Consumes: `BackportGroup`, `BackportSlot`, `SlotState`, `PrEntry`, `PrKey`, `TrackedPr` from `src/types.ts`; `prKey` from `src/domain/prKey.ts`.
- Produces:
  ```ts
  export function groupKey(group: BackportGroup): PrKey;
  export function groupPrs(group: BackportGroup): TrackedPr[];
  export function prStateFor(pr: TrackedPr | null, entries: Map<PrKey, PrEntry>): SlotState;
  export function slotStateFor(slot: BackportSlot, entries: Map<PrKey, PrEntry>): SlotState;
  export type RollUp = { landed: number; total: number };
  export function rollUpFor(group: BackportGroup, entries: Map<PrKey, PrEntry>): RollUp;
  export function isComplete(group: BackportGroup, entries: Map<PrKey, PrEntry>): boolean;
  export function orderGroups(groups: BackportGroup[], entries: Map<PrKey, PrEntry>): BackportGroup[];
  ```

**Design note.** Every function takes the poll entries as a `Map<PrKey, PrEntry>` rather than an array, because each group looks up several specific PRs and a linear scan per slot would be quadratic in the number of tracked PRs. `App` builds the map once per poll.

**A second design note, driven by the UI tasks that consume this module.**
`slotStateFor` is a thin wrapper over `prStateFor`, which takes a bare
`TrackedPr | null` rather than a `BackportSlot`. This exists because a group's
*main* PR needs exactly the same merged/open/closed/pending/errored derivation
as a slot's PR, but a main PR is not a slot and has no `version` to wrap it in.
Without `prStateFor`, `BackportGroupCard` (Task 9) would have to either
duplicate `slotStateFor`'s logic for the main row or synthesize a fake slot
just to reuse it — both worse than exporting the one function both callers
actually need.

- [ ] **Step 1: Write the failing tests**

`src/domain/backports.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/domain/backports.test.ts
```

Expected: FAIL — `Failed to resolve import "./backports"`.

- [ ] **Step 3: Implement `src/domain/backports.ts`**

```ts
import type {
  BackportGroup,
  BackportSlot,
  PrEntry,
  PrKey,
  SlotState,
  TrackedPr,
} from '../types';
import { prKey } from './prKey';

/**
 * A group's identity is its main PR's key. Deriving it rather than generating an
 * id keeps one canonical identity format in the codebase and makes duplicate
 * detection a lookup rather than a search.
 */
export function groupKey(group: BackportGroup): PrKey {
  return prKey(group.main.owner, group.main.repo, group.main.number);
}

/** Every PR this group needs polled: its main, plus each filled slot. */
export function groupPrs(group: BackportGroup): TrackedPr[] {
  const prs: TrackedPr[] = [group.main];
  for (const slot of group.slots) {
    if (slot.pr !== null) prs.push(slot.pr);
  }
  return prs;
}

/**
 * Merge status for a bare PR. This is the only place the tab derives status,
 * and it reads nothing but the lifecycle — no CI, no review, no classification.
 * Takes `TrackedPr | null` rather than a `BackportSlot` so a group's main PR —
 * which is not a slot — can share this derivation with `slotStateFor` below,
 * rather than `BackportGroupCard` reimplementing it for the main row.
 */
export function prStateFor(pr: TrackedPr | null, entries: Map<PrKey, PrEntry>): SlotState {
  if (pr === null) return { kind: 'empty' };

  const entry = entries.get(prKey(pr.owner, pr.repo, pr.number));
  if (entry === undefined) return { kind: 'pending' };
  if (entry.status === 'error') return { kind: 'errored', message: entry.message };

  switch (entry.pr.lifecycle) {
    case 'MERGED':
      return { kind: 'merged' };
    case 'CLOSED':
      return { kind: 'closed' };
    case 'OPEN':
      return { kind: 'open' };
  }
}

/** Merge status for one slot. A thin wrapper over `prStateFor` — see above. */
export function slotStateFor(slot: BackportSlot, entries: Map<PrKey, PrEntry>): SlotState {
  return prStateFor(slot.pr, entries);
}

export type RollUp = { landed: number; total: number };

/**
 * How many target versions have landed. The main PR is excluded from both
 * numbers: it is the thing being backported, not a backport.
 */
export function rollUpFor(group: BackportGroup, entries: Map<PrKey, PrEntry>): RollUp {
  const landed = group.slots.filter(
    (slot) => slotStateFor(slot, entries).kind === 'merged',
  ).length;
  return { landed, total: group.slots.length };
}

/**
 * A group is finished when it asked for at least one version and every one has
 * merged. A group with no versions is deliberately NOT complete — nothing landed
 * because nothing was asked for, and calling it done would bury a group the user
 * is still setting up.
 */
export function isComplete(group: BackportGroup, entries: Map<PrKey, PrEntry>): boolean {
  const { landed, total } = rollUpFor(group, entries);
  return total > 0 && landed === total;
}

/**
 * Incomplete groups first, then finished ones, each by recency. This mirrors the
 * board's instinct of surfacing what still needs attention; a finished group
 * stays until removed, because deciding when landed work stops being interesting
 * is the user's call.
 */
export function orderGroups(
  groups: BackportGroup[],
  entries: Map<PrKey, PrEntry>,
): BackportGroup[] {
  return [...groups].sort((a, b) => {
    const completeDelta = Number(isComplete(a, entries)) - Number(isComplete(b, entries));
    if (completeDelta !== 0) return completeDelta;
    // ISO 8601 in UTC compares correctly as strings; descending.
    return b.addedAt.localeCompare(a.addedAt);
  });
}
```

- [ ] **Step 4: Run the tests, typecheck, and full suite**

```bash
npx vitest run src/domain/backports.test.ts
npm run typecheck
npx vitest run
```

Expected: 19 new tests pass; 266 passing overall; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/domain/backports.ts src/domain/backports.test.ts
git commit -m "feat: derive backport slot state, roll-up and group ordering"
```

---

### Task 3: Extract the shared `localStorage` guards

A refactor, included because this feature would otherwise create a **third** copy of the same throw-guarded access dance. Behaviour must not change and the test count must not move.

**Files:**
- Create: `src/storage/localStorage.ts`
- Modify: `src/storage/trackedPrs.ts` (replace its private `defaultStorage`/`read`/`write`)
- Modify: `src/storage/token.ts` (drop its import from `trackedPrs`)
- Test: `src/storage/localStorage.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function defaultStorage(): Storage | null;
  export function resolveStorage(storage: Storage | null | undefined): Storage | null;
  export function readKey(storage: Storage | null | undefined, key: string): string | null;
  export function writeKey(storage: Storage | null | undefined, key: string, value: string): void;
  export function removeKey(storage: Storage | null | undefined, key: string): void;
  ```

**Why this matters, and what must not break.** `localStorage` can throw on *access*, not just on write — Safari private browsing and browsers configured to block site data both do. Every one of these functions must swallow that. The three-state `storage` parameter is also load-bearing and must survive: `undefined` means use the real `localStorage`, an explicit `Storage` means use that one, and explicit `null` means none is available. `resolveStorage` must use `storage === undefined ? defaultStorage() : storage` and **never** `storage ?? defaultStorage()`, which would silently turn an explicit `null` into the real thing and break every "no storage" test in the suite.

`src/storage/trackedPrs.ts` currently exports `defaultStorage`, and `src/storage/token.ts` imports it from there — an odd coupling that this extraction removes. Keep the re-export from `trackedPrs.ts` **only if** something outside these files imports it; check with `grep -rn "defaultStorage" src/` before deleting.

- [ ] **Step 1: Write the failing tests**

`src/storage/localStorage.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { defaultStorage, readKey, removeKey, resolveStorage, writeKey } from './localStorage';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

/** A Storage whose every accessor throws, as a blocked browser's does. */
function hostileStorage(): Storage {
  const boom = () => {
    throw new Error('SecurityError');
  };
  return {
    get length(): number {
      return boom();
    },
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  };
}

describe('resolveStorage', () => {
  it('is three-state: undefined uses the default, a Storage is used, null means none', () => {
    const storage = fakeStorage();
    expect(resolveStorage(storage)).toBe(storage);
    // Explicit null must NOT fall back to the real localStorage.
    expect(resolveStorage(null)).toBeNull();
    expect(resolveStorage(undefined)).toBe(defaultStorage());
  });
});

describe('readKey', () => {
  it('reads a value', () => {
    expect(readKey(fakeStorage({ a: '1' }), 'a')).toBe('1');
  });

  it('returns null for an absent key', () => {
    expect(readKey(fakeStorage(), 'a')).toBeNull();
  });

  it('returns null when no storage is available', () => {
    expect(readKey(null, 'a')).toBeNull();
  });

  it('returns null rather than throwing when storage access throws', () => {
    expect(readKey(hostileStorage(), 'a')).toBeNull();
  });
});

describe('writeKey', () => {
  it('writes a value', () => {
    const storage = fakeStorage();
    writeKey(storage, 'a', '1');
    expect(storage.getItem('a')).toBe('1');
  });

  it('does nothing when no storage is available', () => {
    expect(() => writeKey(null, 'a', '1')).not.toThrow();
  });

  it('swallows a write failure rather than throwing into a render', () => {
    // Quota exhausted or storage blocked. Losing persistence is survivable;
    // throwing during render is not.
    expect(() => writeKey(hostileStorage(), 'a', '1')).not.toThrow();
  });
});

describe('removeKey', () => {
  it('removes a value', () => {
    const storage = fakeStorage({ a: '1' });
    removeKey(storage, 'a');
    expect(storage.getItem('a')).toBeNull();
  });

  it('swallows a failure', () => {
    expect(() => removeKey(hostileStorage(), 'a')).not.toThrow();
    expect(() => removeKey(null, 'a')).not.toThrow();
  });
});

describe('defaultStorage', () => {
  it('returns null rather than throwing when window.localStorage throws', () => {
    const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(defaultStorage()).toBeNull();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/storage/localStorage.test.ts
```

Expected: FAIL — `Failed to resolve import "./localStorage"`.

- [ ] **Step 3: Implement `src/storage/localStorage.ts`**

```ts
/**
 * Throw-guarded `localStorage` access, shared by every store.
 *
 * `localStorage` can throw on *access*, not merely on write — Safari private
 * browsing and browsers configured to block site data both do — so every use
 * goes through here rather than touching `window.localStorage` directly. A
 * thrown quota or security error must never reach a React render.
 */
export function defaultStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Three-state by design, and the tests depend on it: `undefined` means "use the
 * real localStorage", an explicit `Storage` means "use this one", and explicit
 * `null` means "none is available". Note this is deliberately NOT
 * `storage ?? defaultStorage()`, which would turn an explicit null into the real
 * thing and quietly defeat every no-storage test.
 */
export function resolveStorage(storage: Storage | null | undefined): Storage | null {
  return storage === undefined ? defaultStorage() : storage;
}

export function readKey(storage: Storage | null | undefined, key: string): string | null {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    return target.getItem(key);
  } catch {
    return null;
  }
}

export function writeKey(
  storage: Storage | null | undefined,
  key: string,
  value: string,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.setItem(key, value);
  } catch {
    // Quota exhausted or storage blocked. Losing persistence is survivable;
    // throwing into a render is not.
  }
}

export function removeKey(storage: Storage | null | undefined, key: string): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.removeItem(key);
  } catch {
    // Nothing useful to do.
  }
}
```

- [ ] **Step 4: Run the new tests**

```bash
npx vitest run src/storage/localStorage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Point `trackedPrs.ts` and `token.ts` at the shared module**

First check whether anything outside these files imports `defaultStorage`:

```bash
grep -rn "defaultStorage" src/
```

In `src/storage/trackedPrs.ts`: delete its local `defaultStorage`, `read` and `write` functions, add `import { readKey, writeKey } from './localStorage';`, and replace the call sites — `read(storage, KEY)` becomes `readKey(storage, KEY)` and `write(storage, KEY, value)` becomes `writeKey(storage, KEY, value)`. Note the argument order is unchanged.

In `src/storage/token.ts`: replace `import { defaultStorage } from './trackedPrs';` with `import { readKey, removeKey, writeKey } from './localStorage';`, delete its local `resolve` helper, and route its `getItem`/`setItem`/`removeItem` through `readKey`/`writeKey`/`removeKey`.

Do not change any message string, any validation branch, or any exported signature of either file.

- [ ] **Step 6: Verify behaviour is unchanged**

```bash
npx vitest run src/storage/
npm run typecheck
npx vitest run
```

Expected: the storage suites pass unchanged, and the full suite is **277** — the 266 from Task 2 plus this task's 11 new tests, with **no existing test removed or altered**. If any pre-existing storage test needed editing to pass, stop and report it: that means behaviour changed, which this task forbids.

- [ ] **Step 7: Commit**

```bash
git add src/storage/
git commit -m "refactor: extract the shared throw-guarded localStorage access"
```

---
### Task 4: `storage/backportGroups.ts`

**Files:**
- Create: `src/storage/backportGroups.ts`
- Modify: `src/storage/trackedPrs.ts` (export its existing `isTrackedPr` guard)
- Test: `src/storage/backportGroups.test.ts`

**Interfaces:**
- Consumes: `readKey`, `writeKey` from `src/storage/localStorage.ts` (Task 3); `isTrackedPr` from `src/storage/trackedPrs.ts`; `BackportGroup`, `BackportSlot`, `TrackedPr` from `src/types.ts`.
- Produces:
  ```ts
  export const BACKPORT_GROUPS_KEY = 'hubdash.backports';
  export const CORRUPT_BACKPORT_GROUPS_KEY = 'hubdash.backports.corrupt';
  export type LoadBackportGroupsResult = { groups: BackportGroup[]; error: string | null };
  export function loadBackportGroups(storage?: Storage | null): LoadBackportGroupsResult;
  export function saveBackportGroups(groups: BackportGroup[], storage?: Storage | null): void;
  ```

**Design notes.**

`trackedPrs.ts` already has a private `isTrackedPr` guard that validates owner/repo/number/addedAt. Add `export` to it and import it here rather than writing a second copy — `trackedPrs.ts` owns the `TrackedPr` shape, and a divergent second validator would be exactly the verbatim-duplication problem this codebase has already had to fix once.

**The corrupt-value backup is the most important line in this task**, for the same reason it is in `trackedPrs.ts`: the spec says a malformed value is treated as absent, but taken naively the app would then load an empty list and the first save would overwrite the user's real groups with `[]`. Copying the unusable value to `hubdash.backports.corrupt` first means nothing is silently destroyed.

**Validation rejects the whole value, never individual groups.** Salvaging the parseable ones is silent partial data loss.

- [ ] **Step 1: Export the existing guard from `src/storage/trackedPrs.ts`**

Find `function isTrackedPr(value: unknown): value is TrackedPr {` and prefix it with `export `. Change nothing else in that file.

- [ ] **Step 2: Write the failing tests**

`src/storage/backportGroups.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BackportGroup } from '../types';
import {
  BACKPORT_GROUPS_KEY,
  CORRUPT_BACKPORT_GROUPS_KEY,
  loadBackportGroups,
  saveBackportGroups,
} from './backportGroups';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const group: BackportGroup = {
  main: { owner: 'Graylog2', repo: 'graylog2-server', number: 4821, addedAt: '2026-08-01T00:00:00Z' },
  slots: [
    { version: '6.2', pr: { owner: 'Graylog2', repo: 'graylog2-server', number: 4840, addedAt: '2026-08-02T00:00:00Z' } },
    { version: '6.1', pr: null },
  ],
  addedAt: '2026-08-20T00:00:00Z',
};

function stored(groups: unknown, version: unknown = 1): Record<string, string> {
  return { [BACKPORT_GROUPS_KEY]: JSON.stringify({ version, groups }) };
}

describe('loadBackportGroups', () => {
  it('returns an empty list with no error when the key is absent', () => {
    expect(loadBackportGroups(fakeStorage())).toEqual({ groups: [], error: null });
  });

  it('round-trips a saved list, including a null slot', () => {
    const storage = fakeStorage();
    saveBackportGroups([group], storage);
    expect(loadBackportGroups(storage)).toEqual({ groups: [group], error: null });
  });

  it('reports an error and returns the default for non-JSON', () => {
    const result = loadBackportGroups(fakeStorage({ [BACKPORT_GROUPS_KEY]: 'not json{' }));
    expect(result.groups).toEqual([]);
    expect(result.error).toMatch(/could not be read/i);
  });

  it('rejects a wrong-shaped envelope', () => {
    expect(loadBackportGroups(fakeStorage({ [BACKPORT_GROUPS_KEY]: '[]' })).error).toBeTruthy();
    expect(loadBackportGroups(fakeStorage({ [BACKPORT_GROUPS_KEY]: '{"groups":[]}' })).error).toBeTruthy();
  });

  it('reports a wrong shape rather than a version problem when version is absent', () => {
    const raw = JSON.stringify({ groups: [] });
    expect(loadBackportGroups(fakeStorage({ [BACKPORT_GROUPS_KEY]: raw })).error).toMatch(/could not be read/i);
  });

  it('rejects an unknown version', () => {
    expect(loadBackportGroups(fakeStorage(stored([group], 99))).error).toMatch(/version/i);
  });

  it('rejects a group whose main PR is malformed', () => {
    const bad = { ...group, main: { owner: 'a', repo: 'b', number: 0, addedAt: 'x' } };
    expect(loadBackportGroups(fakeStorage(stored([bad]))).groups).toEqual([]);
    expect(loadBackportGroups(fakeStorage(stored([bad]))).error).toBeTruthy();
  });

  it('rejects a group whose slots are not an array', () => {
    const bad = { ...group, slots: 'nope' };
    expect(loadBackportGroups(fakeStorage(stored([bad]))).error).toBeTruthy();
  });

  it('rejects a slot with an empty or non-string version', () => {
    for (const version of ['', 42, null]) {
      const bad = { ...group, slots: [{ version, pr: null }] };
      expect(loadBackportGroups(fakeStorage(stored([bad]))).error, String(version)).toBeTruthy();
    }
  });

  it('rejects a slot whose pr is present but malformed', () => {
    const bad = { ...group, slots: [{ version: '6.2', pr: { owner: 'a' } }] };
    expect(loadBackportGroups(fakeStorage(stored([bad]))).error).toBeTruthy();
  });

  it('accepts a group with no slots', () => {
    const empty = { ...group, slots: [] };
    expect(loadBackportGroups(fakeStorage(stored([empty])))).toEqual({
      groups: [empty],
      error: null,
    });
  });

  it('preserves an unusable value under the corrupt key so nothing is lost', () => {
    const storage = fakeStorage({ [BACKPORT_GROUPS_KEY]: 'not json{' });
    loadBackportGroups(storage);
    expect(storage.getItem(CORRUPT_BACKPORT_GROUPS_KEY)).toBe('not json{');
  });

  it('never throws when storage is unavailable', () => {
    expect(loadBackportGroups(null)).toEqual({ groups: [], error: null });
  });
});

describe('saveBackportGroups', () => {
  it('writes a versioned envelope', () => {
    const storage = fakeStorage();
    saveBackportGroups([group], storage);
    expect(JSON.parse(storage.getItem(BACKPORT_GROUPS_KEY) ?? '')).toEqual({
      version: 1,
      groups: [group],
    });
  });

  it('never throws when storage is unavailable', () => {
    expect(() => saveBackportGroups([group], null)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run src/storage/backportGroups.test.ts
```

Expected: FAIL — `Failed to resolve import "./backportGroups"`.

- [ ] **Step 4: Implement `src/storage/backportGroups.ts`**

```ts
import type { BackportGroup, BackportSlot } from '../types';
import { readKey, writeKey } from './localStorage';
import { isTrackedPr } from './trackedPrs';

export const BACKPORT_GROUPS_KEY = 'hubdash.backports';
export const CORRUPT_BACKPORT_GROUPS_KEY = 'hubdash.backports.corrupt';

const VERSION = 1;

export type LoadBackportGroupsResult = { groups: BackportGroup[]; error: string | null };

const UNREADABLE = 'Your backport groups could not be read and were reset.';

function isSlot(value: unknown): value is BackportSlot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.version !== 'string' || candidate.version === '') return false;
  return candidate.pr === null || isTrackedPr(candidate.pr);
}

function isGroup(value: unknown): value is BackportGroup {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isTrackedPr(candidate.main) &&
    Array.isArray(candidate.slots) &&
    candidate.slots.every(isSlot) &&
    typeof candidate.addedAt === 'string' &&
    candidate.addedAt !== ''
  );
}

function reject(
  storage: Storage | null | undefined,
  raw: string,
  error: string,
): LoadBackportGroupsResult {
  // Keep the unusable value so a later save cannot destroy the user's groups.
  writeKey(storage, CORRUPT_BACKPORT_GROUPS_KEY, raw);
  return { groups: [], error };
}

export function loadBackportGroups(storage?: Storage | null): LoadBackportGroupsResult {
  const raw = readKey(storage, BACKPORT_GROUPS_KEY);
  if (raw === null) return { groups: [], error: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return reject(storage, raw, UNREADABLE);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return reject(storage, raw, UNREADABLE);
  }

  const envelope = parsed as Record<string, unknown>;
  // A missing version is a wrong shape, not an unsupported version — saying
  // otherwise would send someone hunting for a migration that never existed.
  if (!('version' in envelope)) return reject(storage, raw, UNREADABLE);
  if (envelope.version !== VERSION) {
    return reject(storage, raw, 'Your backport groups use an unsupported version and were reset.');
  }
  if (!Array.isArray(envelope.groups) || !envelope.groups.every(isGroup)) {
    return reject(storage, raw, UNREADABLE);
  }

  return { groups: envelope.groups, error: null };
}

export function saveBackportGroups(
  groups: BackportGroup[],
  storage?: Storage | null,
): void {
  writeKey(storage, BACKPORT_GROUPS_KEY, JSON.stringify({ version: VERSION, groups }));
}
```

- [ ] **Step 5: Run the tests, typecheck, and full suite**

```bash
npx vitest run src/storage/backportGroups.test.ts
npm run typecheck
npx vitest run
```

Expected: 15 new tests pass; **292** passing overall.

- [ ] **Step 6: Commit**

```bash
git add src/storage/backportGroups.ts src/storage/backportGroups.test.ts src/storage/trackedPrs.ts
git commit -m "feat: add a validating store for backport groups"
```

---

### Task 5: `hooks/useBackportGroups.ts`

**Files:**
- Create: `src/hooks/useBackportGroups.ts`
- Test: `src/hooks/useBackportGroups.test.tsx`

**Interfaces:**
- Consumes: `loadBackportGroups`/`saveBackportGroups` (Task 4); `groupKey` (Task 2); `prKey` from `src/domain/prKey.ts`; `ParsedPr` from `src/github/parseUrl.ts`; `BackportGroup`, `BackportSlot`, `PrKey`, `TrackedPr`.
- Produces:
  ```ts
  export type UseBackportGroupsOptions = { storage?: Storage | null; clock?: () => string };
  export type FillSlotOutcome = { ok: true } | { ok: false; error: string };
  export type UseBackportGroupsResult = {
    groups: BackportGroup[];
    addGroup: (main: ParsedPr, versions: string[]) => { added: boolean; key: PrKey };
    removeGroup: (key: PrKey) => void;
    addVersion: (key: PrKey, version: string) => void;
    removeVersion: (key: PrKey, version: string) => void;
    fillSlot: (key: PrKey, version: string, pr: ParsedPr) => FillSlotOutcome;
    storageError: string | null;
    dismissStorageError: () => void;
  };
  export function useBackportGroups(options?: UseBackportGroupsOptions): UseBackportGroupsResult;
  ```

**Design notes — three patterns copied deliberately from `useTrackedPrs`, which was reviewed and fixed during the v1 build.**

1. **A `groupsRef` mirrors the state and every mutation reads it**, rather than using a `setState` updater. `addGroup` and `fillSlot` must return their verdict **synchronously** so the caller can flash a duplicate or show a rejection, and a flag set inside a `setState` updater would be stale by the time the function returned — and under StrictMode the updater can run twice.
2. **Writes are explicit.** Every mutation calls `saveBackportGroups` directly. There is no save-on-change effect, and the hook **never saves on mount** — an eager mount save would overwrite the corrupt-value backup before the user had seen the warning about it.
3. **The default clock is module-scoped** so its identity is stable. Inlining `clock ?? (() => new Date().toISOString())` mints a new function every render and defeats the memoisation; `App` re-renders once a second, so that churn is continuous.

**The rejection rule:** `fillSlot` refuses a PR already used elsewhere in the same group — as the main PR or in another slot — and names where it already sits. The same PR in two slots of one group is always a mistake, and one check prevents a confusing display. Dropping onto an already-filled slot **replaces** its PR; correcting a wrong link is the likely intent.

- [ ] **Step 1: Write the failing tests**

`src/hooks/useBackportGroups.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BACKPORT_GROUPS_KEY } from '../storage/backportGroups';
import { useBackportGroups } from './useBackportGroups';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const clock = () => '2026-08-27T12:00:00Z';
const MAIN = { owner: 'Graylog2', repo: 'graylog2-server', number: 4821 };
const KEY = 'graylog2/graylog2-server#4821';

function setup(storage: Storage = fakeStorage()) {
  return renderHook(() => useBackportGroups({ storage, clock }));
}

describe('useBackportGroups — creating and removing groups', () => {
  it('starts empty when nothing is stored', () => {
    const { result } = setup();
    expect(result.current.groups).toEqual([]);
    expect(result.current.storageError).toBeNull();
  });

  it('adds a group with one slot per version, all empty', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2', '6.1']);
    });
    expect(result.current.groups).toEqual([
      {
        main: { ...MAIN, addedAt: '2026-08-27T12:00:00Z' },
        slots: [
          { version: '6.2', pr: null },
          { version: '6.1', pr: null },
        ],
        addedAt: '2026-08-27T12:00:00Z',
      },
    ]);
  });

  it('accepts a group with no versions', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, []);
    });
    expect(result.current.groups[0]?.slots).toEqual([]);
  });

  it('reports added:true with the key for a new group', () => {
    const { result } = setup();
    let outcome: { added: boolean; key: string } | undefined;
    act(() => {
      outcome = result.current.addGroup(MAIN, ['6.2']);
    });
    expect(outcome).toEqual({ added: true, key: KEY });
  });

  it('reports added:false and does not duplicate a group for the same main PR', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    let outcome: { added: boolean; key: string } | undefined;
    act(() => {
      outcome = result.current.addGroup(MAIN, ['6.1']);
    });
    expect(outcome?.added).toBe(false);
    expect(result.current.groups).toHaveLength(1);
    // The existing group is left exactly as it was, not merged with the new versions.
    expect(result.current.groups[0]?.slots.map((s) => s.version)).toEqual(['6.2']);
  });

  it('treats a casing difference as the same main PR', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    let outcome: { added: boolean } | undefined;
    act(() => {
      outcome = result.current.addGroup(
        { owner: 'GRAYLOG2', repo: 'Graylog2-Server', number: 4821 },
        ['6.1'],
      );
    });
    expect(outcome?.added).toBe(false);
  });

  it('adds two groups in sequence without losing the first', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, []);
      result.current.addGroup({ ...MAIN, number: 4900 }, []);
    });
    expect(result.current.groups.map((g) => g.main.number)).toEqual([4821, 4900]);
  });

  it('removes a group by key and persists the removal', () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => useBackportGroups({ storage, clock }));
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    act(() => {
      result.current.removeGroup(KEY);
    });
    expect(result.current.groups).toEqual([]);
    expect(JSON.parse(storage.getItem(BACKPORT_GROUPS_KEY) ?? '').groups).toEqual([]);
  });

  it('ignores a remove for an unknown key', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, []);
    });
    act(() => {
      result.current.removeGroup('nope/nope#1');
    });
    expect(result.current.groups).toHaveLength(1);
  });
});

describe('useBackportGroups — versions', () => {
  it('adds a version as a new empty slot at the end', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    act(() => {
      result.current.addVersion(KEY, '6.1');
    });
    expect(result.current.groups[0]?.slots).toEqual([
      { version: '6.2', pr: null },
      { version: '6.1', pr: null },
    ]);
  });

  it('ignores a version the group already has', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    act(() => {
      result.current.addVersion(KEY, '6.2');
    });
    expect(result.current.groups[0]?.slots).toHaveLength(1);
  });

  it('removes a version and its PR without confirmation', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2', '6.1']);
    });
    act(() => {
      result.current.fillSlot(KEY, '6.2', { ...MAIN, number: 4840 });
    });
    act(() => {
      result.current.removeVersion(KEY, '6.2');
    });
    expect(result.current.groups[0]?.slots).toEqual([{ version: '6.1', pr: null }]);
  });

  it('ignores a remove for a version the group does not have', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    act(() => {
      result.current.removeVersion(KEY, '5.0');
    });
    expect(result.current.groups[0]?.slots).toHaveLength(1);
  });
});

describe('useBackportGroups — filling slots', () => {
  it('fills an empty slot and persists it', () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => useBackportGroups({ storage, clock }));
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    act(() => {
      result.current.fillSlot(KEY, '6.2', { ...MAIN, number: 4840 });
    });
    expect(result.current.groups[0]?.slots[0]?.pr).toEqual({
      ...MAIN,
      number: 4840,
      addedAt: '2026-08-27T12:00:00Z',
    });
    expect(JSON.parse(storage.getItem(BACKPORT_GROUPS_KEY) ?? '').groups[0].slots[0].pr.number).toBe(4840);
  });

  it('replaces the PR in an already-filled slot', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    act(() => {
      result.current.fillSlot(KEY, '6.2', { ...MAIN, number: 4840 });
    });
    let outcome: { ok: boolean } | undefined;
    act(() => {
      outcome = result.current.fillSlot(KEY, '6.2', { ...MAIN, number: 4899 });
    });
    expect(outcome?.ok).toBe(true);
    expect(result.current.groups[0]?.slots[0]?.pr?.number).toBe(4899);
  });

  it('rejects a PR already filling another slot in the same group, naming where', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2', '6.1']);
    });
    act(() => {
      result.current.fillSlot(KEY, '6.2', { ...MAIN, number: 4840 });
    });
    let outcome: { ok: boolean; error?: string } | undefined;
    act(() => {
      outcome = result.current.fillSlot(KEY, '6.1', { ...MAIN, number: 4840 });
    });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toMatch(/6\.2/);
    expect(result.current.groups[0]?.slots[1]?.pr).toBeNull();
  });

  it('rejects the group main PR being used as one of its own backports', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    let outcome: { ok: boolean; error?: string } | undefined;
    act(() => {
      outcome = result.current.fillSlot(KEY, '6.2', MAIN);
    });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toMatch(/main/i);
  });

  it('allows the same PR in two different groups', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
      result.current.addGroup({ ...MAIN, number: 4900 }, ['6.2']);
    });
    let outcome: { ok: boolean } | undefined;
    act(() => {
      result.current.fillSlot(KEY, '6.2', { ...MAIN, number: 4840 });
      outcome = result.current.fillSlot('graylog2/graylog2-server#4900', '6.2', {
        ...MAIN,
        number: 4840,
      });
    });
    expect(outcome?.ok).toBe(true);
  });

  it('ignores a fill for an unknown group or version', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    act(() => {
      result.current.fillSlot('nope/nope#1', '6.2', { ...MAIN, number: 4840 });
      result.current.fillSlot(KEY, '9.9', { ...MAIN, number: 4840 });
    });
    expect(result.current.groups[0]?.slots[0]?.pr).toBeNull();
  });
});

describe('useBackportGroups — storage errors', () => {
  it('surfaces a load error and lets it be dismissed', () => {
    const { result } = setup(fakeStorage({ [BACKPORT_GROUPS_KEY]: 'not json{' }));
    expect(result.current.storageError).toBeTruthy();
    act(() => {
      result.current.dismissStorageError();
    });
    expect(result.current.storageError).toBeNull();
  });

  it('does not overwrite an unreadable stored value until the user changes something', () => {
    const storage = fakeStorage({ [BACKPORT_GROUPS_KEY]: 'not json{' });
    renderHook(() => useBackportGroups({ storage, clock }));
    expect(storage.getItem(BACKPORT_GROUPS_KEY)).toBe('not json{');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/hooks/useBackportGroups.test.tsx
```

Expected: FAIL — `Failed to resolve import "./useBackportGroups"`.

- [ ] **Step 3: Implement `src/hooks/useBackportGroups.ts`**

```ts
import { useCallback, useRef, useState } from 'react';
import { groupKey } from '../domain/backports';
import { prKey } from '../domain/prKey';
import type { ParsedPr } from '../github/parseUrl';
import { loadBackportGroups, saveBackportGroups } from '../storage/backportGroups';
import type { BackportGroup, BackportSlot, PrKey, TrackedPr } from '../types';

/**
 * Module-level so its identity is stable. Inlining this as
 * `clock ?? (() => new Date().toISOString())` would mint a new function on every
 * render and defeat the memoisation below — and App re-renders once a second to
 * drive the freshness label, so that churn would be continuous.
 */
const defaultClock = () => new Date().toISOString();

export type UseBackportGroupsOptions = {
  storage?: Storage | null;
  clock?: () => string;
};

export type FillSlotOutcome = { ok: true } | { ok: false; error: string };

export type UseBackportGroupsResult = {
  groups: BackportGroup[];
  addGroup: (main: ParsedPr, versions: string[]) => { added: boolean; key: PrKey };
  removeGroup: (key: PrKey) => void;
  addVersion: (key: PrKey, version: string) => void;
  removeVersion: (key: PrKey, version: string) => void;
  fillSlot: (key: PrKey, version: string, pr: ParsedPr) => FillSlotOutcome;
  storageError: string | null;
  dismissStorageError: () => void;
};

function keyOf(pr: TrackedPr | ParsedPr): PrKey {
  return prKey(pr.owner, pr.repo, pr.number);
}

/** Where in a group a PR is already used, or null if it is free. */
function usedIn(group: BackportGroup, pr: ParsedPr, exceptVersion: string): string | null {
  const key = keyOf(pr);
  if (keyOf(group.main) === key) return 'main';
  for (const slot of group.slots) {
    if (slot.version === exceptVersion) continue;
    if (slot.pr !== null && keyOf(slot.pr) === key) return slot.version;
  }
  return null;
}

/**
 * Owns the backport groups. Writes are explicit — every mutation saves — and the
 * hook never saves on mount, so an unreadable stored value is not overwritten
 * before the user has seen the warning about it.
 */
export function useBackportGroups(
  options: UseBackportGroupsOptions = {},
): UseBackportGroupsResult {
  const { storage, clock } = options;
  const now = clock ?? defaultClock;

  const initial = useRef<{ groups: BackportGroup[]; error: string | null } | null>(null);
  if (initial.current === null) {
    initial.current = loadBackportGroups(storage);
  }

  const [groups, setGroups] = useState<BackportGroup[]>(initial.current.groups);
  const [storageError, setStorageError] = useState<string | null>(initial.current.error);

  // Mirrors `groups` so mutations decide synchronously and return a verdict the
  // caller can act on — flashing a duplicate, or showing a rejection.
  const groupsRef = useRef<BackportGroup[]>(initial.current.groups);

  const commit = useCallback(
    (next: BackportGroup[]) => {
      groupsRef.current = next;
      saveBackportGroups(next, storage);
      setGroups(next);
    },
    [storage],
  );

  /** Applies `change` to the group with `key`, committing only if it produced a new value. */
  const mapGroup = useCallback(
    (key: PrKey, change: (group: BackportGroup) => BackportGroup | null) => {
      let changed = false;
      const next = groupsRef.current.map((group) => {
        if (groupKey(group) !== key) return group;
        const updated = change(group);
        if (updated === null) return group;
        changed = true;
        return updated;
      });
      if (changed) commit(next);
    },
    [commit],
  );

  const addGroup = useCallback(
    (main: ParsedPr, versions: string[]) => {
      const key = keyOf(main);
      if (groupsRef.current.some((group) => groupKey(group) === key)) {
        return { added: false, key };
      }
      const addedAt = now();
      commit([
        ...groupsRef.current,
        {
          main: { ...main, addedAt },
          slots: versions.map((version) => ({ version, pr: null })),
          addedAt,
        },
      ]);
      return { added: true, key };
    },
    [commit, now],
  );

  const removeGroup = useCallback(
    (key: PrKey) => {
      const next = groupsRef.current.filter((group) => groupKey(group) !== key);
      if (next.length === groupsRef.current.length) return;
      commit(next);
    },
    [commit],
  );

  const addVersion = useCallback(
    (key: PrKey, version: string) => {
      mapGroup(key, (group) =>
        group.slots.some((slot) => slot.version === version)
          ? null
          : { ...group, slots: [...group.slots, { version, pr: null }] },
      );
    },
    [mapGroup],
  );

  const removeVersion = useCallback(
    (key: PrKey, version: string) => {
      mapGroup(key, (group) => {
        const slots = group.slots.filter((slot) => slot.version !== version);
        return slots.length === group.slots.length ? null : { ...group, slots };
      });
    },
    [mapGroup],
  );

  const fillSlot = useCallback(
    (key: PrKey, version: string, pr: ParsedPr): FillSlotOutcome => {
      const group = groupsRef.current.find((candidate) => groupKey(candidate) === key);
      if (!group) return { ok: true };
      if (!group.slots.some((slot) => slot.version === version)) return { ok: true };

      const clash = usedIn(group, pr, version);
      if (clash !== null) {
        return {
          ok: false,
          error:
            clash === 'main'
              ? 'That is this group’s main pull request, so it cannot also be one of its backports.'
              : `That pull request is already filling the ${clash} slot.`,
        };
      }

      const filled: TrackedPr = { ...pr, addedAt: now() };
      mapGroup(key, (current) => ({
        ...current,
        slots: current.slots.map((slot: BackportSlot) =>
          slot.version === version ? { ...slot, pr: filled } : slot,
        ),
      }));
      return { ok: true };
    },
    [mapGroup, now],
  );

  const dismissStorageError = useCallback(() => setStorageError(null), []);

  return {
    groups,
    addGroup,
    removeGroup,
    addVersion,
    removeVersion,
    fillSlot,
    storageError,
    dismissStorageError,
  };
}
```

- [ ] **Step 4: Run the tests, typecheck, and full suite**

```bash
npx vitest run src/hooks/useBackportGroups.test.tsx
npm run typecheck
npx vitest run
```

Expected: 21 new tests pass; **313** passing overall; output pristine — no `act()` warnings.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useBackportGroups.ts src/hooks/useBackportGroups.test.tsx
git commit -m "feat: add the backport groups hook with slot and version mutations"
```

---

### Task 6: Extract `BoardTab` from `App`

A pure refactor with **no behaviour change**. Its own task so a reviewer can verify exactly that in isolation, before any tab machinery lands.

**Files:**
- Create: `src/ui/Empty.tsx`
- Create: `src/ui/BoardTab.tsx`
- Modify: `src/ui/App.tsx`
- Test: none new — the existing `src/ui/App.test.tsx` is the regression net.

**Interfaces:**
- Produces:
  ```ts
  // src/ui/Empty.tsx
  export const Empty: StyledComponent<'div', ...>;   // the existing styled div, moved

  // src/ui/BoardTab.tsx
  export type BoardTabProps = {
    columns: Record<ColumnId, PrEntry[]>;
    isEmpty: boolean;
    flashedKey: PrKey | null;
    onRemove: (key: PrKey) => void;
  };
  export function BoardTab(props: BoardTabProps): JSX.Element;
  ```

**What moves and what does not.** `BoardTab` takes over exactly two things from `App`'s render: the "Add a pull request…" empty state, and the `<Board>` element. The **token** prompt stays in `App`, because with no token nothing can be resolved on either tab — it is app-level, not board-level. `App` keeps every hook, all state, the top bar, all four banners, both dialogs and the drop overlay.

**The test count must not move.** This task adds no tests and removes none: `App.test.tsx` already covers the board rendering, the empty states and removal, and it must pass **unaltered**. If a test needs editing to keep passing, stop and report it — that means behaviour changed, which this task forbids.

- [ ] **Step 1: Create `src/ui/Empty.tsx`**

Move the `Empty` styled component out of `App.tsx` verbatim — three consumers will want it (`App`, `BoardTab`, and later `BackportsTab`), and a second copy is how duplication starts.

```ts
import styled from 'styled-components';
import { tokens } from './theme';

/** The centred prompt shown when a tab or the app has nothing to display. */
export const Empty = styled.div`
  padding: ${tokens.space(12)} ${tokens.space(5)};
  text-align: center;
  color: ${tokens.color.textMuted};
  font-family: ${tokens.font.body};
`;
```

- [ ] **Step 2: Create `src/ui/BoardTab.tsx`**

```tsx
import type { ColumnId, PrEntry, PrKey } from '../types';
import { Board } from './Board';
import { Empty } from './Empty';

export type BoardTabProps = {
  columns: Record<ColumnId, PrEntry[]>;
  /** True when nothing is tracked, so the board would render four empty columns. */
  isEmpty: boolean;
  flashedKey: PrKey | null;
  onRemove: (key: PrKey) => void;
};

/**
 * The board tab's content: the tracked pull requests, or a prompt to add one.
 * Deliberately free of any decision — grouping and ordering happen in
 * `domain/sort.ts` before anything reaches here.
 */
export function BoardTab({ columns, isEmpty, flashedKey, onRemove }: BoardTabProps) {
  if (isEmpty) {
    return <Empty>Add a pull request — use the button, paste a URL, or drop a link here.</Empty>;
  }
  return <Board columns={columns} onRemove={onRemove} flashedKey={flashedKey} />;
}
```

- [ ] **Step 3: Rewire `App.tsx`**

Delete the local `Empty` styled component and `import { Empty } from './Empty';` instead. Delete the `import { Board } from './Board';` and import `BoardTab` instead. Then replace this block:

```tsx
      {token !== null && prs.length === 0 ? (
        <Empty>Add a pull request — use the button, paste a URL, or drop a link here.</Empty>
      ) : null}
      {showBoard ? (
        <Board columns={columns} onRemove={handleRemove} flashedKey={flashedKey} />
      ) : null}
```

with:

```tsx
      {token !== null ? (
        <BoardTab
          columns={columns}
          isEmpty={prs.length === 0}
          flashedKey={flashedKey}
          onRemove={handleRemove}
        />
      ) : null}
```

The `showBoard` constant is now unused — delete it, or `noUnusedLocals` will fail the typecheck. Leave the token prompt above it exactly as it is.

- [ ] **Step 4: Verify nothing changed**

```bash
npx vitest run src/ui/App.test.tsx
npm run typecheck
npm run build
npx vitest run
```

Expected: `App.test.tsx` passes **unaltered**; the full suite is still **313** — the same count as Task 5, because this task adds no tests; typecheck and build clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/Empty.tsx src/ui/BoardTab.tsx src/ui/App.tsx
git commit -m "refactor: move the board's rendering out of App into BoardTab"
```

---
### Task 7: Extract drop/paste text extraction into a shared module

A small refactor, done now because Task 8 needs the same logic `useDragAndPaste.ts` already has private, and a second hand-written copy is exactly the kind of duplication this codebase has already had to remove once (`asRecord`, fixed in the v1 final review).

**Files:**
- Create: `src/domain/dropText.ts`
- Modify: `src/hooks/useDragAndPaste.ts` (delegate to it)
- Test: `src/domain/dropText.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function firstUri(raw: string): string;
  export function textFrom(transfer: DataTransfer | null | undefined): string;
  ```

**What must not change.** `src/hooks/useDragAndPaste.test.tsx` has 9 tests today and must pass **unaltered** — this task moves logic, it does not change behaviour.

- [ ] **Step 1: Write the failing tests**

`src/domain/dropText.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { firstUri, textFrom } from './dropText';

function dataTransfer(types: Record<string, string>): DataTransfer {
  return {
    types: Object.keys(types),
    getData: (type: string) => types[type] ?? '',
  } as unknown as DataTransfer;
}

describe('firstUri', () => {
  it('returns the single line unchanged', () => {
    expect(firstUri('https://github.com/a/b/pull/1')).toBe('https://github.com/a/b/pull/1');
  });

  it('skips comment lines starting with #', () => {
    expect(firstUri('# a comment\nhttps://github.com/a/b/pull/1\n')).toBe(
      'https://github.com/a/b/pull/1',
    );
  });

  it('returns empty for an all-comment or blank payload', () => {
    expect(firstUri('# only a comment')).toBe('');
    expect(firstUri('   \n  ')).toBe('');
  });
});

describe('textFrom', () => {
  it('prefers text/uri-list over text/plain', () => {
    expect(
      textFrom(dataTransfer({ 'text/uri-list': 'https://a/1', 'text/plain': 'something else' })),
    ).toBe('https://a/1');
  });

  it('falls back to text/plain', () => {
    expect(textFrom(dataTransfer({ 'text/plain': 'https://a/2' }))).toBe('https://a/2');
  });

  it('trims text/plain', () => {
    expect(textFrom(dataTransfer({ 'text/plain': '  https://a/3  ' }))).toBe('https://a/3');
  });

  it('returns empty for a null or undefined transfer', () => {
    expect(textFrom(null)).toBe('');
    expect(textFrom(undefined)).toBe('');
  });

  it('returns empty when both fields are empty', () => {
    expect(textFrom(dataTransfer({}))).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/domain/dropText.test.ts
```

Expected: FAIL — `Failed to resolve import "./dropText"`.

- [ ] **Step 3: Implement `src/domain/dropText.ts`**

```ts
/** A text/uri-list may carry comment lines beginning with '#'. */
export function firstUri(raw: string): string {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '' && !trimmed.startsWith('#')) return trimmed;
  }
  return '';
}

/**
 * Extracts a pastable/droppable string from a drag or clipboard payload.
 * `text/uri-list` is preferred over `text/plain`, because a dragged link
 * supplies both and the plain-text version is sometimes the link's visible
 * label rather than its href.
 */
export function textFrom(transfer: DataTransfer | null | undefined): string {
  if (!transfer) return '';
  const uriList = transfer.getData('text/uri-list');
  if (uriList.trim() !== '') return firstUri(uriList);
  return transfer.getData('text/plain').trim();
}
```

- [ ] **Step 4: Rewire `src/hooks/useDragAndPaste.ts`**

Delete the local `firstUri` and `textFrom` functions. Add `import { textFrom } from '../domain/dropText';` at the top. Leave `isEditable` and everything else in the file unchanged.

- [ ] **Step 5: Verify nothing changed, and run the full suite**

```bash
npx vitest run src/hooks/useDragAndPaste.test.tsx
npx vitest run src/domain/dropText.test.ts
npm run typecheck
npx vitest run
```

Expected: `useDragAndPaste.test.tsx` still shows 9 passing, unaltered; `dropText.test.ts` shows 8 passing; full suite **321**.

- [ ] **Step 6: Commit**

```bash
git add src/domain/dropText.ts src/domain/dropText.test.ts src/hooks/useDragAndPaste.ts
git commit -m "refactor: extract drop/paste text extraction for reuse by backport slots"
```

---

### Task 8: `SlotRow`

The per-slot drop target. Each slot is independently droppable, unlike the board where the whole window is the target — see spec §10.4.

**Files:**
- Create: `src/ui/SlotRow.tsx`
- Test: `src/ui/SlotRow.test.tsx`

**Interfaces:**
- Consumes: `slotStateFor` (Task 2); `textFrom` (Task 7); `parsePrUrl`, `ParsedPr` (existing, `src/github/parseUrl.ts`); `BackportSlot`, `PrEntry`, `PrKey`, `SlotState`; `tokens` (existing, `src/ui/theme.ts`).
- Produces:
  ```ts
  export type SlotRowProps = {
    slot: BackportSlot;
    entries: Map<PrKey, PrEntry>;
    onFill: (pr: ParsedPr) => { ok: true } | { ok: false; error: string };
    onRemoveVersion: () => void;
  };
  export function SlotRow(props: SlotRowProps): JSX.Element;
  ```

**Design notes.**

Every slot is a drop target, filled or not (spec §10.3) — dropping onto a filled slot replaces it, which is the likely intent when correcting a wrong link. `SlotRow` parses the dropped or typed text itself with `parsePrUrl` and only calls `onFill` with the resulting `ParsedPr` — never the raw string — so every caller of `onFill` (`BackportGroupCard`, then `App`) receives an already-valid PR and never re-parses. `onFill`'s return value covers the *second* way a fill can fail: `useBackportGroups.fillSlot`'s rejection when the PR is already used elsewhere in the group. `SlotRow` shows either error inline, in the same place, with the same styling — the reader cannot tell which stage produced it, and does not need to.

A click on the slot also reveals a small inline URL input, so the row is usable without dragging — spec §10.3's keyboard-accessible path. The input and the drop target coexist rather than being modal states: clicking to type does not disable dropping.

Only the visible symbols differ per state: `empty` shows the drop invitation, `pending` shows a neutral placeholder, `open`/`merged`/`closed` show the PR number linked to GitHub plus a status word, `errored` shows the PR number and GitHub's message in the bad colour.

- [ ] **Step 1: Write the failing tests**

`src/ui/SlotRow.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makePr } from '../test/makePr';
import type { BackportSlot, PrEntry, PrKey } from '../types';
import { SlotRow } from './SlotRow';

function tracked(number: number) {
  return { owner: 'Graylog2', repo: 'graylog2-server', number, addedAt: '2026-08-01T00:00:00Z' };
}

function entryMap(...specs: Array<[number, 'OPEN' | 'CLOSED' | 'MERGED']>): Map<PrKey, PrEntry> {
  const map = new Map<PrKey, PrEntry>();
  for (const [number, lifecycle] of specs) {
    const pr = makePr({ number, lifecycle });
    map.set(pr.key, { status: 'ok', key: pr.key, tracked: tracked(number), pr });
  }
  return map;
}

function dataTransfer(text: string): DataTransfer {
  return { types: ['text/plain'], getData: () => text } as unknown as DataTransfer;
}

const EMPTY: BackportSlot = { version: '6.0', pr: null };
const FILLED: BackportSlot = { version: '6.2', pr: tracked(4840) };

describe('SlotRow — display', () => {
  it('shows the version label and an invitation when empty', () => {
    render(<SlotRow slot={EMPTY} entries={new Map()} onFill={() => ({ ok: true })} onRemoveVersion={() => {}} />);
    expect(screen.getByText('6.0')).toBeInTheDocument();
    expect(screen.getByText(/drop a pull request/i)).toBeInTheDocument();
  });

  it('shows pending when a PR is set but has no entry yet', () => {
    render(<SlotRow slot={FILLED} entries={new Map()} onFill={() => ({ ok: true })} onRemoveVersion={() => {}} />);
    expect(screen.getByText('#4840')).toBeInTheDocument();
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });

  it('shows merged, open and closed from the entry', () => {
    const { rerender } = render(
      <SlotRow slot={FILLED} entries={entryMap([4840, 'MERGED'])} onFill={() => ({ ok: true })} onRemoveVersion={() => {}} />,
    );
    expect(screen.getByText(/merged/i)).toBeInTheDocument();

    rerender(
      <SlotRow slot={FILLED} entries={entryMap([4840, 'CLOSED'])} onFill={() => ({ ok: true })} onRemoveVersion={() => {}} />,
    );
    expect(screen.getByText(/closed, not merged/i)).toBeInTheDocument();
  });

  it('shows the GitHub message for an errored PR', () => {
    const map = new Map<PrKey, PrEntry>([
      ['graylog2/graylog2-server#4840', { status: 'error', key: 'graylog2/graylog2-server#4840', tracked: tracked(4840), message: 'Not found' }],
    ]);
    render(<SlotRow slot={FILLED} entries={map} onFill={() => ({ ok: true })} onRemoveVersion={() => {}} />);
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });

  it('links the PR number to GitHub', () => {
    render(<SlotRow slot={FILLED} entries={entryMap([4840, 'OPEN'])} onFill={() => ({ ok: true })} onRemoveVersion={() => {}} />);
    expect(screen.getByRole('link', { name: '#4840' })).toHaveAttribute(
      'href',
      'https://github.com/Graylog2/graylog2-server/pull/4840',
    );
  });
});

describe('SlotRow — filling by drop', () => {
  it('parses a dropped URL and calls onFill with it', () => {
    const onFill = vi.fn().mockReturnValue({ ok: true });
    render(<SlotRow slot={EMPTY} entries={new Map()} onFill={onFill} onRemoveVersion={() => {}} />);
    const row = screen.getByTestId('slot-row');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: dataTransfer('https://github.com/Graylog2/graylog2-server/pull/4839') });
    act(() => void row.dispatchEvent(event));
    expect(onFill).toHaveBeenCalledWith({ owner: 'Graylog2', repo: 'graylog2-server', number: 4839 });
  });

  it('shows a parse error inline without calling onFill', () => {
    const onFill = vi.fn();
    render(<SlotRow slot={EMPTY} entries={new Map()} onFill={onFill} onRemoveVersion={() => {}} />);
    const row = screen.getByTestId('slot-row');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: dataTransfer('https://gitlab.com/a/b/pull/1') });
    act(() => void row.dispatchEvent(event));
    expect(onFill).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/github\.com/i);
  });

  it('shows onFill’s rejection message when it refuses the PR', () => {
    const onFill = vi.fn().mockReturnValue({ ok: false, error: 'That pull request is already filling the 6.1 slot.' });
    render(<SlotRow slot={EMPTY} entries={new Map()} onFill={onFill} onRemoveVersion={() => {}} />);
    const row = screen.getByTestId('slot-row');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: dataTransfer('https://github.com/Graylog2/graylog2-server/pull/4840') });
    act(() => void row.dispatchEvent(event));
    expect(screen.getByRole('alert')).toHaveTextContent(/6\.1 slot/);
  });

  it('prevents the default on dragover so the browser allows the drop', () => {
    render(<SlotRow slot={EMPTY} entries={new Map()} onFill={() => ({ ok: true })} onRemoveVersion={() => {}} />);
    const event = new Event('dragover', { bubbles: true, cancelable: true });
    screen.getByTestId('slot-row').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('SlotRow — filling by click-to-paste', () => {
  it('reveals a URL input on click and fills on submit', async () => {
    const onFill = vi.fn().mockReturnValue({ ok: true });
    render(<SlotRow slot={EMPTY} entries={new Map()} onFill={onFill} onRemoveVersion={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /add a link/i }));
    const input = screen.getByLabelText(/pull request url/i);
    await userEvent.type(input, 'https://github.com/Graylog2/graylog2-server/pull/4839{Enter}');
    expect(onFill).toHaveBeenCalledWith({ owner: 'Graylog2', repo: 'graylog2-server', number: 4839 });
  });
});

describe('SlotRow — removing a version', () => {
  it('calls onRemoveVersion, without confirmation', async () => {
    const onRemoveVersion = vi.fn();
    render(<SlotRow slot={EMPTY} entries={new Map()} onFill={() => ({ ok: true })} onRemoveVersion={onRemoveVersion} />);
    await userEvent.click(screen.getByRole('button', { name: /remove 6\.0/i }));
    expect(onRemoveVersion).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/ui/SlotRow.test.tsx
```

Expected: FAIL — `Failed to resolve import "./SlotRow"`.

- [ ] **Step 3: Implement `src/ui/SlotRow.tsx`**

```tsx
import { useId, useState } from 'react';
import styled from 'styled-components';
import { slotStateFor } from '../domain/backports';
import { textFrom } from '../domain/dropText';
import type { ParsedPr } from '../github/parseUrl';
import { parsePrUrl } from '../github/parseUrl';
import type { BackportSlot, PrEntry, PrKey } from '../types';
import { tokens } from './theme';

export type SlotRowProps = {
  slot: BackportSlot;
  entries: Map<PrKey, PrEntry>;
  onFill: (pr: ParsedPr) => { ok: true } | { ok: false; error: string };
  onRemoveVersion: () => void;
};

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: ${tokens.space(3)};
  padding: ${tokens.space(2)} 0;
  border-bottom: 1px solid ${tokens.color.border};
`;

const Version = styled.span`
  width: 3.5em;
  font-family: ${tokens.font.mono};
  color: ${tokens.color.textMuted};
  flex-shrink: 0;
`;

const Number = styled.a`
  font-family: ${tokens.font.mono};
  color: ${tokens.color.accent};
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const Status = styled.span<{ $tone: string }>`
  color: ${(props) => props.$tone};
  font-size: 13px;
`;

const Invitation = styled.span`
  color: ${tokens.color.textMuted};
  font-size: 13px;
  font-style: italic;
`;

const Spacer = styled.span`
  flex: 1;
`;

const IconButton = styled.button`
  background: none;
  border: none;
  color: ${tokens.color.textMuted};
  cursor: pointer;
  font-size: 13px;

  &:hover {
    color: ${tokens.color.text};
  }
`;

const Input = styled.input`
  flex: 1;
  padding: ${tokens.space(1)} ${tokens.space(2)};
  background: ${tokens.color.background};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  color: ${tokens.color.text};
  font-family: ${tokens.font.mono};
  font-size: 12px;
`;

const Error = styled.p`
  margin: ${tokens.space(1)} 0 0;
  font-size: 12px;
  color: ${tokens.color.bad};
`;

function statusOf(slot: BackportSlot, entries: Map<PrKey, PrEntry>) {
  const state = slotStateFor(slot, entries);
  switch (state.kind) {
    case 'merged':
      return { label: '✓ merged', tone: tokens.color.good };
    case 'open':
      return { label: '○ open', tone: tokens.color.textMuted };
    case 'closed':
      return { label: '✖ closed, not merged', tone: tokens.color.bad };
    case 'errored':
      return { label: state.message, tone: tokens.color.bad };
    case 'pending':
      return { label: '… pending', tone: tokens.color.textMuted };
    case 'empty':
      return null;
  }
}

export function SlotRow({ slot, entries, onFill, onRemoveVersion }: SlotRowProps) {
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputId = useId();

  const fill = (raw: string) => {
    const parsed = parsePrUrl(raw);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const outcome = onFill(parsed.value);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setError(null);
    setEditing(false);
    setValue('');
  };

  const status = statusOf(slot, entries);

  return (
    <div>
      <Row
        data-testid="slot-row"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const text = textFrom(event.dataTransfer);
          if (text !== '') fill(text);
        }}
      >
        <Version>{slot.version}</Version>
        {slot.pr === null ? null : (
          <Number
            href={`https://github.com/${slot.pr.owner}/${slot.pr.repo}/pull/${slot.pr.number}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            {`#${slot.pr.number}`}
          </Number>
        )}
        {status === null ? (
          <Invitation>drop a pull request link here</Invitation>
        ) : (
          <Status $tone={status.tone}>{status.label}</Status>
        )}
        <Spacer />
        {editing ? null : (
          <IconButton type="button" aria-label="Add a link" onClick={() => setEditing(true)}>
            {slot.pr === null ? '+ link' : 'replace'}
          </IconButton>
        )}
        <IconButton
          type="button"
          aria-label={`Remove ${slot.version}`}
          onClick={onRemoveVersion}
        >
          ✕
        </IconButton>
      </Row>
      {editing ? (
        <Row as="form" onSubmit={(event) => { event.preventDefault(); fill(value); }}>
          <label htmlFor={inputId} style={{ position: 'absolute', left: '-9999px' }}>
            Pull request URL
          </label>
          <Input
            id={inputId}
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="https://github.com/owner/repo/pull/123"
          />
        </Row>
      ) : null}
      {error === null ? null : <Error role="alert">{error}</Error>}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests, typecheck, and full suite**

```bash
npx vitest run src/ui/SlotRow.test.tsx
npm run typecheck
npx vitest run
```

Expected: 11 new tests pass; **332** passing overall; output pristine.

- [ ] **Step 5: Commit**

```bash
git add src/ui/SlotRow.tsx src/ui/SlotRow.test.tsx
git commit -m "feat: add the per-slot drop target and merge-status row"
```

---
### Task 9: `BackportGroupCard`

**Files:**
- Create: `src/ui/BackportGroupCard.tsx`
- Test: `src/ui/BackportGroupCard.test.tsx`

**Interfaces:**
- Consumes: `SlotRow` (Task 8); `prStateFor`, `rollUpFor`, `isComplete` (Task 2); `prKey` (existing, `src/domain/prKey.ts`); `ParsedPr` (existing, `src/github/parseUrl.ts`); `BackportGroup`, `PrEntry`, `PrKey`; `tokens` (existing).
- Produces:
  ```ts
  export type BackportGroupCardProps = {
    group: BackportGroup;
    entries: Map<PrKey, PrEntry>;
    onRemoveGroup: () => void;
    onAddVersion: (version: string) => void;
    onRemoveVersion: (version: string) => void;
    onFillSlot: (version: string, pr: ParsedPr) => { ok: true } | { ok: false; error: string };
  };
  export function BackportGroupCard(props: BackportGroupCardProps): JSX.Element;
  ```

**Design notes.**

The main PR gets its own row, rendered with `prStateFor(group.main, entries)` rather than a `SlotRow` — it is not a slot and cannot be removed independently (removing the group removes it). One-line "add a version" control at the bottom, submitting on Enter, using `parseVersions` so `"6.2, 6.1"` becomes two calls to `onAddVersion` — but if `parseVersions` returns an already-present version, `onAddVersion` is still called and the hook's existing no-op handles it; the card does not need to duplicate that check.

A fully-landed group (`isComplete`) is dimmed, mirroring how the board dims drafts — the same visual vocabulary for "this needs less of your attention right now."

- [ ] **Step 1: Write the failing tests**

`src/ui/BackportGroupCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makePr } from '../test/makePr';
import type { BackportGroup, PrEntry, PrKey } from '../types';
import { BackportGroupCard } from './BackportGroupCard';

function tracked(number: number) {
  return { owner: 'Graylog2', repo: 'graylog2-server', number, addedAt: '2026-08-01T00:00:00Z' };
}

function entryMap(...specs: Array<[number, 'OPEN' | 'CLOSED' | 'MERGED']>): Map<PrKey, PrEntry> {
  const map = new Map<PrKey, PrEntry>();
  for (const [number, lifecycle] of specs) {
    const pr = makePr({ number, lifecycle, title: `Fix ${number}` });
    map.set(pr.key, { status: 'ok', key: pr.key, tracked: tracked(number), pr });
  }
  return map;
}

function group(overrides: Partial<BackportGroup> = {}): BackportGroup {
  return {
    main: tracked(4821),
    slots: [
      { version: '6.2', pr: tracked(4840) },
      { version: '6.1', pr: null },
    ],
    addedAt: '2026-08-20T00:00:00Z',
    ...overrides,
  };
}

function setup(overrides: Partial<Parameters<typeof BackportGroupCard>[0]> = {}) {
  const props = {
    group: group(),
    entries: entryMap([4821, 'MERGED'], [4840, 'MERGED']),
    onRemoveGroup: vi.fn(),
    onAddVersion: vi.fn(),
    onRemoveVersion: vi.fn(),
    onFillSlot: vi.fn().mockReturnValue({ ok: true }),
    ...overrides,
  };
  render(<BackportGroupCard {...props} />);
  return props;
}

describe('BackportGroupCard — display', () => {
  it('shows the main PR number, title and repo', () => {
    setup();
    expect(screen.getByText('#4821')).toBeInTheDocument();
    expect(screen.getByText('Fix 4821')).toBeInTheDocument();
    expect(screen.getByText('Graylog2/graylog2-server')).toBeInTheDocument();
  });

  it('shows the roll-up as N of M landed', () => {
    setup();
    expect(screen.getByText('1 of 2 landed')).toBeInTheDocument();
  });

  it('shows zero of zero for a group with no versions', () => {
    setup({ group: group({ slots: [] }) });
    expect(screen.getByText('0 of 0 landed')).toBeInTheDocument();
  });

  it('renders one row per slot', () => {
    setup();
    expect(screen.getByText('6.2')).toBeInTheDocument();
    expect(screen.getByText('6.1')).toBeInTheDocument();
  });

  it('dims a fully-landed group', () => {
    setup({
      group: group({ slots: [{ version: '6.2', pr: tracked(4840) }] }),
      entries: entryMap([4821, 'MERGED'], [4840, 'MERGED']),
    });
    expect(screen.getByTestId('backport-group-card')).toHaveAttribute('data-complete', 'true');
  });

  it('does not dim an incomplete group', () => {
    setup();
    expect(screen.getByTestId('backport-group-card')).toHaveAttribute('data-complete', 'false');
  });
});

describe('BackportGroupCard — actions', () => {
  it('calls onRemoveGroup', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /remove group/i }));
    expect(props.onRemoveGroup).toHaveBeenCalled();
  });

  it('adds one version from the input', async () => {
    const props = setup();
    await userEvent.type(screen.getByLabelText(/add version/i), '6.0{Enter}');
    expect(props.onAddVersion).toHaveBeenCalledWith('6.0');
  });

  it('adds multiple comma-separated versions from one submit', async () => {
    const props = setup();
    await userEvent.type(screen.getByLabelText(/add version/i), '6.0, 5.2{Enter}');
    expect(props.onAddVersion).toHaveBeenNthCalledWith(1, '6.0');
    expect(props.onAddVersion).toHaveBeenNthCalledWith(2, '5.2');
  });

  it('clears the input after adding', async () => {
    setup();
    const input = screen.getByLabelText(/add version/i);
    await userEvent.type(input, '6.0{Enter}');
    expect(input).toHaveValue('');
  });

  it('does not submit an empty or blank input', async () => {
    const props = setup();
    await userEvent.type(screen.getByLabelText(/add version/i), '   {Enter}');
    expect(props.onAddVersion).not.toHaveBeenCalled();
  });

  it('passes fillSlot and removeVersion through to the right slot row', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /remove 6\.1/i }));
    expect(props.onRemoveVersion).toHaveBeenCalledWith('6.1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/ui/BackportGroupCard.test.tsx
```

Expected: FAIL — `Failed to resolve import "./BackportGroupCard"`.

- [ ] **Step 3: Implement `src/ui/BackportGroupCard.tsx`**

```tsx
import { useState } from 'react';
import styled from 'styled-components';
import { isComplete, prStateFor, rollUpFor } from '../domain/backports';
import { parseVersions } from '../domain/parseVersions';
import { prKey } from '../domain/prKey';
import type { ParsedPr } from '../github/parseUrl';
import type { BackportGroup, PrEntry, PrKey } from '../types';
import { SlotRow } from './SlotRow';
import { tokens } from './theme';

export type BackportGroupCardProps = {
  group: BackportGroup;
  entries: Map<PrKey, PrEntry>;
  onRemoveGroup: () => void;
  onAddVersion: (version: string) => void;
  onRemoveVersion: (version: string) => void;
  onFillSlot: (version: string, pr: ParsedPr) => { ok: true } | { ok: false; error: string };
};

const Card = styled.article`
  padding: ${tokens.space(3)} ${tokens.space(4)};
  background: ${tokens.color.surface};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  font-family: ${tokens.font.body};
  color: ${tokens.color.text};

  &[data-complete='true'] {
    opacity: 0.6;
  }
`;

const Header = styled.div`
  display: flex;
  align-items: baseline;
  gap: ${tokens.space(2)};
`;

const NumberLabel = styled.span`
  font-family: ${tokens.font.mono};
  color: ${tokens.color.textMuted};
`;

const Title = styled.span`
  font-weight: 600;
  flex: 1;
`;

const RollUp = styled.span`
  font-size: 12px;
  color: ${tokens.color.textMuted};
`;

const RemoveGroup = styled.button`
  background: none;
  border: none;
  color: ${tokens.color.textMuted};
  cursor: pointer;

  &:hover {
    color: ${tokens.color.bad};
  }
`;

const Meta = styled.div`
  font-size: 12px;
  color: ${tokens.color.textMuted};
  margin-bottom: ${tokens.space(2)};
`;

const MainStatus = styled.span`
  font-size: 13px;
  color: ${tokens.color.textMuted};
`;

const AddVersionInput = styled.input`
  margin-top: ${tokens.space(2)};
  width: 100%;
  padding: ${tokens.space(1)} ${tokens.space(2)};
  background: ${tokens.color.background};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  color: ${tokens.color.text};
  font-family: ${tokens.font.mono};
  font-size: 12px;
`;

function mainLabel(state: ReturnType<typeof prStateFor>): string {
  switch (state.kind) {
    case 'merged':
      return '✓ merged';
    case 'open':
      return '○ open';
    case 'closed':
      return '✖ closed, not merged';
    case 'errored':
      return state.message;
    case 'pending':
      return '… pending';
    case 'empty':
      return '';
  }
}

export function BackportGroupCard({
  group,
  entries,
  onRemoveGroup,
  onAddVersion,
  onRemoveVersion,
  onFillSlot,
}: BackportGroupCardProps) {
  const [versionInput, setVersionInput] = useState('');
  const { landed, total } = rollUpFor(group, entries);
  const mainKey = `${group.main.owner}/${group.main.repo}`;
  const mainEntry = entries.get(prKey(group.main.owner, group.main.repo, group.main.number));
  const mainTitle = mainEntry?.status === 'ok' ? mainEntry.pr.title : '';

  const submitVersions = (event: React.FormEvent) => {
    event.preventDefault();
    for (const version of parseVersions(versionInput)) {
      onAddVersion(version);
    }
    setVersionInput('');
  };

  return (
    <Card data-testid="backport-group-card" data-complete={isComplete(group, entries) ? 'true' : 'false'}>
      <Header>
        <NumberLabel>{`#${group.main.number}`}</NumberLabel>
        <Title>{mainTitle}</Title>
        <RollUp>{`${landed} of ${total} landed`}</RollUp>
        <RemoveGroup type="button" aria-label="Remove group" onClick={onRemoveGroup}>
          ✕
        </RemoveGroup>
      </Header>
      <Meta>
        {/* mainKey wrapped in its own element so it has an exact, matchable
            textContent — as a bare sibling text node next to MainStatus, no
            single element's textContent would equal just the repo string. */}
        <span>{mainKey}</span> · <MainStatus>{mainLabel(prStateFor(group.main, entries))}</MainStatus>
      </Meta>
      {group.slots.map((slot) => (
        <SlotRow
          key={slot.version}
          slot={slot}
          entries={entries}
          onFill={(pr) => onFillSlot(slot.version, pr)}
          onRemoveVersion={() => onRemoveVersion(slot.version)}
        />
      ))}
      <form onSubmit={submitVersions}>
        <label htmlFor={`add-version-${group.main.number}`} style={{ position: 'absolute', left: '-9999px' }}>
          Add version
        </label>
        <AddVersionInput
          id={`add-version-${group.main.number}`}
          value={versionInput}
          onChange={(event) => setVersionInput(event.target.value)}
          placeholder="+ version, e.g. 6.0 or 6.0, 5.2"
        />
      </form>
    </Card>
  );
}
```

- [ ] **Step 4: Run the tests, typecheck, and full suite**

```bash
npx vitest run src/ui/BackportGroupCard.test.tsx
npm run typecheck
npx vitest run
```

Expected: 12 new tests pass; **344** passing overall; output pristine.

- [ ] **Step 5: Commit**

```bash
git add src/ui/BackportGroupCard.tsx src/ui/BackportGroupCard.test.tsx
git commit -m "feat: add the backport group card with main row, slots and roll-up"
```

---

### Task 10: `AddBackportGroupDialog`

**Files:**
- Create: `src/ui/AddBackportGroupDialog.tsx`
- Test: `src/ui/AddBackportGroupDialog.test.tsx`

**Interfaces:**
- Consumes: `parsePrUrl`, `ParsedPr` (existing, `src/github/parseUrl.ts`); `parseVersions` (Task 1); `tokens` (existing).
- Produces:
  ```ts
  export type AddBackportGroupDialogProps = {
    open: boolean;
    onClose: () => void;
    onAdd: (main: ParsedPr, versions: string[]) => { added: boolean; key: string };
  };
  export function AddBackportGroupDialog(props: AddBackportGroupDialogProps): JSX.Element | null;
  ```

**Design notes.** Two independently validated fields, mirroring `AddPrDialog`'s shape closely enough that the two dialogs read as siblings. The main PR field uses `parsePrUrl` and shows its message verbatim, exactly like `AddPrDialog`. The versions field is optional — an empty or all-blank list is not an error, since spec §5 says a zero-slot group is valid. As with `AddPrDialog`, a duplicate (`added: false`) is not an error; the dialog still closes, and the caller flashes the existing card.

- [ ] **Step 1: Write the failing tests**

`src/ui/AddBackportGroupDialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddBackportGroupDialog } from './AddBackportGroupDialog';

const URL = 'https://github.com/Graylog2/graylog2-server/pull/4821';

function setup(onAdd = vi.fn().mockReturnValue({ added: true, key: 'k' })) {
  const onClose = vi.fn();
  render(<AddBackportGroupDialog open onClose={onClose} onAdd={onAdd} />);
  return { onAdd, onClose };
}

describe('AddBackportGroupDialog', () => {
  it('renders nothing when closed', () => {
    render(<AddBackportGroupDialog open={false} onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('creates a group from a valid URL and a version list', async () => {
    const { onAdd, onClose } = setup();
    await userEvent.type(screen.getByLabelText(/main pull request/i), URL);
    await userEvent.type(screen.getByLabelText(/backport to/i), '6.2, 6.1');
    await userEvent.click(screen.getByRole('button', { name: /track/i }));

    expect(onAdd).toHaveBeenCalledWith(
      { owner: 'Graylog2', repo: 'graylog2-server', number: 4821 },
      ['6.2', '6.1'],
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('accepts an empty version list', async () => {
    const { onAdd } = setup();
    await userEvent.type(screen.getByLabelText(/main pull request/i), URL);
    await userEvent.click(screen.getByRole('button', { name: /track/i }));
    expect(onAdd).toHaveBeenCalledWith(
      { owner: 'Graylog2', repo: 'graylog2-server', number: 4821 },
      [],
    );
  });

  it('shows the parser error and does not add, for an invalid main PR URL', async () => {
    const { onAdd, onClose } = setup();
    await userEvent.type(screen.getByLabelText(/main pull request/i), 'https://gitlab.com/a/b/pull/1');
    await userEvent.click(screen.getByRole('button', { name: /track/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/github\.com/i);
    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('tells nothing extra and still closes when the main PR is already tracked', async () => {
    const onAdd = vi.fn().mockReturnValue({ added: false, key: 'k' });
    const { onClose } = setup(onAdd);
    await userEvent.type(screen.getByLabelText(/main pull request/i), URL);
    await userEvent.click(screen.getByRole('button', { name: /track/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape and on Cancel', async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('resets both fields when reopened', async () => {
    const { rerender } = render(
      <AddBackportGroupDialog open onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />,
    );
    await userEvent.type(screen.getByLabelText(/main pull request/i), URL);
    rerender(<AddBackportGroupDialog open={false} onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />);
    rerender(<AddBackportGroupDialog open onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />);
    expect(screen.getByLabelText(/main pull request/i)).toHaveValue('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/ui/AddBackportGroupDialog.test.tsx
```

Expected: FAIL — `Failed to resolve import "./AddBackportGroupDialog"`.

- [ ] **Step 3: Implement `src/ui/AddBackportGroupDialog.tsx`**

```tsx
import { useEffect, useId, useState } from 'react';
import styled from 'styled-components';
import { parseVersions } from '../domain/parseVersions';
import type { ParsedPr } from '../github/parseUrl';
import { parsePrUrl } from '../github/parseUrl';
import { tokens } from './theme';

export type AddBackportGroupDialogProps = {
  open: boolean;
  onClose: () => void;
  onAdd: (main: ParsedPr, versions: string[]) => { added: boolean; key: string };
};

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(1, 4, 9, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
`;

const Panel = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${tokens.space(3)};
  width: min(520px, calc(100vw - 32px));
  padding: ${tokens.space(5)};
  background: ${tokens.color.surface};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  font-family: ${tokens.font.body};
  color: ${tokens.color.text};
`;

const Label = styled.label`
  font-size: 13px;
  font-weight: 600;
`;

const Input = styled.input`
  padding: ${tokens.space(2)} ${tokens.space(3)};
  background: ${tokens.color.background};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  color: ${tokens.color.text};
  font-family: ${tokens.font.mono};
  font-size: 13px;
`;

const Hint = styled.p`
  margin: 0;
  font-size: 12px;
  color: ${tokens.color.textMuted};
`;

const Error = styled.p`
  margin: 0;
  font-size: 12px;
  color: ${tokens.color.bad};
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: ${tokens.space(2)};
`;

const Button = styled.button`
  padding: ${tokens.space(2)} ${tokens.space(4)};
  background: ${tokens.color.surfaceRaised};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  color: ${tokens.color.text};
  font-family: ${tokens.font.body};
  font-size: 13px;
  cursor: pointer;

  &:hover {
    border-color: ${tokens.color.accent};
  }
`;

export function AddBackportGroupDialog({ open, onClose, onAdd }: AddBackportGroupDialogProps) {
  const [url, setUrl] = useState('');
  const [versions, setVersions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const urlId = useId();
  const versionsId = useId();

  useEffect(() => {
    if (!open) {
      setUrl('');
      setVersions('');
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parsePrUrl(url);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    // A duplicate is not an error: the caller flashes the existing group.
    onAdd(parsed.value, parseVersions(versions));
    onClose();
  };

  return (
    <Backdrop onClick={onClose}>
      <Panel
        role="dialog"
        aria-modal="true"
        aria-label="Track backports"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <Label htmlFor={urlId}>Main pull request</Label>
        <Input
          id={urlId}
          autoFocus
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setError(null);
          }}
          placeholder="https://github.com/owner/repo/pull/123"
        />
        <Label htmlFor={versionsId}>Backport to</Label>
        <Input
          id={versionsId}
          value={versions}
          onChange={(event) => setVersions(event.target.value)}
          placeholder="6.2, 6.1, 6.0"
        />
        <Hint>Comma separated. You can add or remove versions later.</Hint>
        {error === null ? null : <Error role="alert">{error}</Error>}
        <Actions>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Track</Button>
        </Actions>
      </Panel>
    </Backdrop>
  );
}
```

- [ ] **Step 4: Run the tests, typecheck, and full suite**

```bash
npx vitest run src/ui/AddBackportGroupDialog.test.tsx
npm run typecheck
npx vitest run
```

Expected: 7 new tests pass; **351** passing overall.

- [ ] **Step 5: Commit**

```bash
git add src/ui/AddBackportGroupDialog.tsx src/ui/AddBackportGroupDialog.test.tsx
git commit -m "feat: add the create-backport-group dialog"
```

---

### Task 11: `BackportsTab`

**Files:**
- Create: `src/ui/BackportsTab.tsx`
- Test: `src/ui/BackportsTab.test.tsx`

**Interfaces:**
- Consumes: `BackportGroupCard` (Task 9); `orderGroups` (Task 2); `Empty` (Task 6); `ParsedPr` (existing, `src/github/parseUrl.ts`); `BackportGroup`, `PrEntry`, `PrKey`.
- Produces:
  ```ts
  export type BackportsTabProps = {
    groups: BackportGroup[];
    entries: Map<PrKey, PrEntry>;
    hasToken: boolean;
    onRemoveGroup: (key: PrKey) => void;
    onAddVersion: (key: PrKey, version: string) => void;
    onRemoveVersion: (key: PrKey, version: string) => void;
    onFillSlot: (key: PrKey, version: string, pr: ParsedPr) => { ok: true } | { ok: false; error: string };
  };
  export function BackportsTab(props: BackportsTabProps): JSX.Element;
  ```

**Design note.** Ordering (`orderGroups`) happens here, once, rather than being the caller's job — mirroring how `App` calls `groupIntoColumns` once for the board rather than leaving `Board` to sort. `hasToken` selects between the two empty states spec §10.6 describes: no token at all, versus a token but no groups yet.

- [ ] **Step 1: Write the failing tests**

`src/ui/BackportsTab.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BackportGroup, PrEntry, PrKey } from '../types';
import { BackportsTab } from './BackportsTab';

function tracked(number: number) {
  return { owner: 'Graylog2', repo: 'graylog2-server', number, addedAt: '2026-08-01T00:00:00Z' };
}

function group(mainNumber: number, addedAt: string): BackportGroup {
  return { main: tracked(mainNumber), slots: [], addedAt };
}

function baseProps(overrides: Partial<Parameters<typeof BackportsTab>[0]> = {}) {
  return {
    groups: [],
    entries: new Map<PrKey, PrEntry>(),
    hasToken: true,
    onRemoveGroup: vi.fn(),
    onAddVersion: vi.fn(),
    onRemoveVersion: vi.fn(),
    onFillSlot: vi.fn().mockReturnValue({ ok: true }),
    ...overrides,
  };
}

describe('BackportsTab', () => {
  it('prompts for a token when there is none', () => {
    render(<BackportsTab {...baseProps({ hasToken: false })} />);
    expect(screen.getByText(/add a github token/i)).toBeInTheDocument();
  });

  it('prompts to track a PR when there is a token but no groups', () => {
    render(<BackportsTab {...baseProps({ hasToken: true, groups: [] })} />);
    expect(screen.getByText(/track/i)).toBeInTheDocument();
  });

  it('renders one card per group, ordered by orderGroups', () => {
    const groups = [group(1, '2026-08-01T00:00:00Z'), group(2, '2026-08-20T00:00:00Z')];
    render(<BackportsTab {...baseProps({ groups })} />);
    const cards = screen.getAllByTestId('backport-group-card');
    expect(cards).toHaveLength(2);
    // Both are zero-slot, so orderGroups falls back to addedAt descending.
    expect(cards[0]).toHaveTextContent('#2');
    expect(cards[1]).toHaveTextContent('#1');
  });

  it('routes onRemoveGroup with the right group key', async () => {
    const onRemoveGroup = vi.fn();
    render(<BackportsTab {...baseProps({ groups: [group(4821, '2026-08-20T00:00:00Z')], onRemoveGroup })} />);
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.click(screen.getByRole('button', { name: /remove group/i }));
    expect(onRemoveGroup).toHaveBeenCalledWith('graylog2/graylog2-server#4821');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/ui/BackportsTab.test.tsx
```

Expected: FAIL — `Failed to resolve import "./BackportsTab"`.

- [ ] **Step 3: Implement `src/ui/BackportsTab.tsx`**

```tsx
import styled from 'styled-components';
import { groupKey, orderGroups } from '../domain/backports';
import type { ParsedPr } from '../github/parseUrl';
import type { BackportGroup, PrEntry, PrKey } from '../types';
import { BackportGroupCard } from './BackportGroupCard';
import { Empty } from './Empty';
import { tokens } from './theme';

export type BackportsTabProps = {
  groups: BackportGroup[];
  entries: Map<PrKey, PrEntry>;
  hasToken: boolean;
  onRemoveGroup: (key: PrKey) => void;
  onAddVersion: (key: PrKey, version: string) => void;
  onRemoveVersion: (key: PrKey, version: string) => void;
  onFillSlot: (key: PrKey, version: string, pr: ParsedPr) => { ok: true } | { ok: false; error: string };
};

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${tokens.space(3)};
  padding: ${tokens.space(5)};
`;

export function BackportsTab({
  groups,
  entries,
  hasToken,
  onRemoveGroup,
  onAddVersion,
  onRemoveVersion,
  onFillSlot,
}: BackportsTabProps) {
  if (!hasToken) {
    return <Empty>Add a GitHub token in settings to start tracking backports.</Empty>;
  }
  if (groups.length === 0) {
    return <Empty>Track a pull request's backports — use the button above.</Empty>;
  }

  return (
    <List>
      {orderGroups(groups, entries).map((group) => {
        const key = groupKey(group);
        return (
          <BackportGroupCard
            key={key}
            group={group}
            entries={entries}
            onRemoveGroup={() => onRemoveGroup(key)}
            onAddVersion={(version) => onAddVersion(key, version)}
            onRemoveVersion={(version) => onRemoveVersion(key, version)}
            onFillSlot={(version, pr) => onFillSlot(key, version, pr)}
          />
        );
      })}
    </List>
  );
}
```

- [ ] **Step 4: Run the tests, typecheck, and full suite**

```bash
npx vitest run src/ui/BackportsTab.test.tsx
npm run typecheck
npx vitest run
```

Expected: 4 new tests pass; **355** passing overall.

- [ ] **Step 5: Commit**

```bash
git add src/ui/BackportsTab.tsx src/ui/BackportsTab.test.tsx
git commit -m "feat: add the ordered backports tab with its two empty states"
```

---

### Task 12: `TabBar`

**Files:**
- Create: `src/ui/TabBar.tsx`
- Test: `src/ui/TabBar.test.tsx`

**Interfaces:**
- Consumes: `tokens` (existing).
- Produces:
  ```ts
  export type TabId = 'board' | 'backports';
  export type TabBarProps = {
    active: TabId;
    onChange: (tab: TabId) => void;
    boardCount: number;
    backportsCount: number;
  };
  export function TabBar(props: TabBarProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests**

`src/ui/TabBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TabBar } from './TabBar';

describe('TabBar', () => {
  it('shows both tabs with their counts', () => {
    render(<TabBar active="board" onChange={() => {}} boardCount={3} backportsCount={2} />);
    expect(screen.getByRole('tab', { name: /board/i })).toHaveTextContent('3');
    expect(screen.getByRole('tab', { name: /backports/i })).toHaveTextContent('2');
  });

  it('marks the active tab selected', () => {
    render(<TabBar active="backports" onChange={() => {}} boardCount={0} backportsCount={0} />);
    expect(screen.getByRole('tab', { name: /backports/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /board/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange with the clicked tab', async () => {
    const onChange = vi.fn();
    render(<TabBar active="board" onChange={onChange} boardCount={0} backportsCount={0} />);
    await userEvent.click(screen.getByRole('tab', { name: /backports/i }));
    expect(onChange).toHaveBeenCalledWith('backports');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/ui/TabBar.test.tsx
```

Expected: FAIL — `Failed to resolve import "./TabBar"`.

- [ ] **Step 3: Implement `src/ui/TabBar.tsx`**

```tsx
import styled from 'styled-components';
import { tokens } from './theme';

export type TabId = 'board' | 'backports';

export type TabBarProps = {
  active: TabId;
  onChange: (tab: TabId) => void;
  boardCount: number;
  backportsCount: number;
};

const Bar = styled.div`
  display: flex;
  gap: ${tokens.space(4)};
  padding: 0 ${tokens.space(5)};
  border-bottom: 1px solid ${tokens.color.border};
`;

const Tab = styled.button`
  padding: ${tokens.space(2)} 0;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: ${tokens.color.textMuted};
  font-family: ${tokens.font.body};
  font-size: 13px;
  cursor: pointer;

  &[aria-selected='true'] {
    color: ${tokens.color.text};
    border-bottom-color: ${tokens.color.accent};
  }
`;

export function TabBar({ active, onChange, boardCount, backportsCount }: TabBarProps) {
  return (
    <Bar role="tablist">
      <Tab role="tab" aria-selected={active === 'board'} onClick={() => onChange('board')}>
        {`Board  ${boardCount}`}
      </Tab>
      <Tab role="tab" aria-selected={active === 'backports'} onClick={() => onChange('backports')}>
        {`Backports  ${backportsCount}`}
      </Tab>
    </Bar>
  );
}
```

- [ ] **Step 4: Run the tests, typecheck, and full suite**

```bash
npx vitest run src/ui/TabBar.test.tsx
npm run typecheck
npx vitest run
```

Expected: 3 new tests pass; **358** passing overall.

- [ ] **Step 5: Commit**

```bash
git add src/ui/TabBar.tsx src/ui/TabBar.test.tsx
git commit -m "feat: add the tab bar"
```

---
### Task 13: Wire the Backports tab into `App`

The integration task. `App` gains a second tab's state, a union poll target list, and per-tab drag behaviour, while keeping the board's behaviour byte-for-byte what it was.

**Files:**
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/TopBar.tsx` (one new optional prop)
- Test: `src/ui/App.test.tsx` (new describe blocks; existing ones must keep passing unaltered)
- Test: `src/ui/TopBar.test.tsx` (one new test for the optional prop)

**Interfaces:**
- Consumes: everything built in Tasks 1–12 — `groupPrs`, `groupKey` (Task 2); `useBackportGroups` (Task 5); `BoardTab` (Task 6); `BackportsTab` (Task 11); `TabBar`, `TabId` (Task 12); `AddBackportGroupDialog` (Task 10).
- Produces: no new exports. `App`'s exported `POLL_INTERVAL_MS`, `RATE_LIMIT_FALLBACK_MS`, and `AppDeps` are unchanged.

**What changes in `App.tsx`, precisely — read against the current file before editing.**

1. **New imports:** `groupPrs`, `groupKey` from `../domain/backports`; `useBackportGroups` from `../hooks/useBackportGroups`; `AddBackportGroupDialog` from `./AddBackportGroupDialog`; `BackportsTab` from `./BackportsTab`; `BoardTab` from `./BoardTab` (replacing the direct `Board` import that Task 6 already redirected); `TabBar`, type `TabId` from `./TabBar`.

2. **New state**, added beside the existing `useState` calls:
   ```ts
   const [activeTab, setActiveTab] = useState<TabId>('board');
   const [backportDialogOpen, setBackportDialogOpen] = useState(false);
   ```

3. **The backport groups hook**, added beside the `useTrackedPrs` call:
   ```ts
   const {
     groups,
     addGroup,
     removeGroup,
     addVersion,
     removeVersion,
     fillSlot,
     storageError: backportStorageError,
     dismissStorageError: dismissBackportStorageError,
   } = useBackportGroups({ storage, clock });
   ```

4. **Union poll targets.** Replace every use of the bare `prs` inside `poll` and `canPoll` with a computed union. **Placement matters**: `canPoll` and `poll` are defined early in the function (right after the `rateLimited` line, well before the existing `columns` memo), so this `useMemo` must go immediately after Step 3's `useBackportGroups` call — above `rateLimited`/`canPoll` — not "near `columns`" the way a first instinct groups memos by topic. Declaring it later would reference `pollTargets` before its `const` initialises, a temporal-dead-zone `ReferenceError` at render time, not a type error `tsc` would catch:
   ```ts
   // Both tabs are fed by one poll. Twenty PRs spread across board and
   // backports still cost one GraphQL request, because the query batches by
   // alias — see spec §9.
   const pollTargets = useMemo(() => {
     const byKey = new Map<PrKey, TrackedPr>();
     for (const pr of prs) byKey.set(prKey(pr.owner, pr.repo, pr.number), pr);
     for (const group of groups) {
       for (const pr of groupPrs(group)) byKey.set(prKey(pr.owner, pr.repo, pr.number), pr);
     }
     return [...byKey.values()];
   }, [prs, groups]);
   ```
   This needs `TrackedPr` added to the existing `import type { ColumnId, PrEntry, PrKey, RateLimit, TransportError } from '../types';` line.

5. **Rewire `canPoll` and `poll` to use `pollTargets` instead of `prs`:**
   ```ts
   const canPoll =
     token !== null && pollTargets.length > 0 && transportError?.kind !== 'auth' && !rateLimited;

   const poll = useCallback(async () => {
     if (!canPoll || token === null) return;

     const outcome = await fetchBoard(token, pollTargets, fetchImpl ? { fetchImpl } : {});
     if (!outcome.ok) {
       reportTransportError(outcome.error);
       return;
     }
     reportTransportError(null);
     setEntries(outcome.result.entries);
     setRateLimit(outcome.result.rateLimit);
     setLastUpdatedAt(new Date(nowMs()).toISOString());
   }, [canPoll, token, pollTargets, fetchImpl, nowMs, reportTransportError]);
   ```
   The immediate-poll-on-list-change effect must react to `pollTargets`, not just `prs`:
   ```ts
   useEffect(() => {
     if (firstRun.current) {
       firstRun.current = false;
       return;
     }
     if (canPoll) refresh();
   }, [pollTargets, canPoll, refresh]);
   ```

6. **An entries lookup map for the Backports tab**, alongside the existing `columns` memo:
   ```ts
   const entryMap = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries]);
   ```

7. **Per-tab drag behaviour (spec §10.4).** `useDragAndPaste` must not act while Backports is showing, because a dropped link on that tab has to land in a specific slot, not anywhere on the board. Wrap the existing callback:
   ```ts
   const addFromText = useCallback(
     (text: string) => {
       if (activeTab !== 'board') return;
       const parsed = parsePrUrl(text);
       if (!parsed.ok) {
         setInputError(parsed.error);
         return;
       }
       setInputError(null);
       addParsed(parsed.value);
     },
     [activeTab, addParsed],
   );
   ```
   `DropOverlay`'s `visible` prop must also stop showing on that tab: change `<DropOverlay visible={isDragging} />` to `<DropOverlay visible={isDragging && activeTab === 'board'} />`. The window-level listeners in `useDragAndPaste` stay registered either way — spec §10.4 disables the *behaviour*, not the listener, and gating inside the callback is simpler and equally correct than tearing the hook's effect down and back up on every tab switch.

8. **The add-button and its dialog become tab-aware.** Replace the single `<AddPrDialog>` render with both dialogs, and make `TopBar`'s add button context-sensitive:
   ```tsx
   <TopBar
     onAdd={() => (activeTab === 'board' ? setAddOpen(true) : setBackportDialogOpen(true))}
     addLabel={activeTab === 'board' ? '+ Add PR' : '+ Track backports'}
     onRefresh={refresh}
     isPolling={isPolling}
     freshness={freshness}
     rateLimit={rateLimit}
     onOpenSettings={() => setSettingsOpen(true)}
   />
   ```

9. **The tab bar and tab content**, replacing the token-gated block that currently renders `BoardTab` directly:
   ```tsx
   {token === null ? (
     <Empty>Add a GitHub token in settings to start tracking pull requests.</Empty>
   ) : (
     <>
       <TabBar
         active={activeTab}
         onChange={setActiveTab}
         boardCount={prs.length}
         backportsCount={groups.length}
       />
       {activeTab === 'board' ? (
         <BoardTab
           columns={columns}
           isEmpty={prs.length === 0}
           flashedKey={flashedKey}
           onRemove={handleRemove}
         />
       ) : (
         <BackportsTab
           groups={groups}
           entries={entryMap}
           hasToken
           onRemoveGroup={removeGroup}
           onAddVersion={addVersion}
           onRemoveVersion={removeVersion}
           onFillSlot={fillSlot}
         />
       )}
     </>
   )}
   ```
   Note `BackportsTab`'s `hasToken` is hardcoded `true` here, because this whole branch is already inside `token === null ? ... : ...` — the no-token empty state in `BackportsTab` exists for its own component tests, not for this call site.

10. **The backport storage-error banner**, added beside the existing `storageError` banner:
    ```tsx
    {backportStorageError === null ? null : (
      <Banner tone="warn" onDismiss={dismissBackportStorageError}>
        {backportStorageError}
      </Banner>
    )}
    ```

11. **The create-group dialog**, added beside `<AddPrDialog>`:
    ```tsx
    <AddBackportGroupDialog
      open={backportDialogOpen}
      onClose={() => setBackportDialogOpen(false)}
      onAdd={(main, versions) => addGroup(main, versions)}
    />
    ```

**What must NOT change.** Every existing behaviour: the board's rendering, all four original banners, both original dialogs, the freshness label, the rate-limit backoff, the auth stop, the coalescing in-flight guard, the first-run token prompt. `App.test.tsx`'s existing tests assert on `prs` being what drives `canPoll` and the board — after this change they must still pass, because a board-only scenario (no groups) makes `pollTargets` exactly equal to `prs`.

- [ ] **Step 1: Add the `addLabel` prop to `TopBar` first, as its own small change**

Write the failing test in `src/ui/TopBar.test.tsx`, added to the existing `describe('TopBar', ...)` block:

```ts
  it('uses a custom add-button label when given one, defaulting to "+ Add PR"', () => {
    setup();
    expect(screen.getByRole('button', { name: '+ Add PR' })).toBeInTheDocument();
  });

  it('shows the given addLabel', () => {
    setup({ addLabel: '+ Track backports' });
    expect(screen.getByRole('button', { name: '+ Track backports' })).toBeInTheDocument();
  });
```

Run it, watch it fail (`addLabel` is not a valid prop under strict typing, or the label never changes), then in `src/ui/TopBar.tsx` add `addLabel?: string;` to `TopBarProps`, default it in the destructured parameters (`addLabel = '+ Add PR'`), and replace the hardcoded button text:

```tsx
      <Button type="button" onClick={onAdd}>
        {addLabel}
      </Button>
```

```bash
npx vitest run src/ui/TopBar.test.tsx
```

Expected: 5 passing (3 existing + 2 new), all existing assertions unaltered.

- [ ] **Step 2: Write the failing App-level tests**

Add these `describe` blocks to `src/ui/App.test.tsx`. They use the same `boardResponder`, `fakeStorage`, `clock`, and `nowMs` helpers already defined in that file — do not redefine them.

```tsx
describe('App — the Backports tab', () => {
  it('starts on the Board tab', async () => {
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);
    expect(await screen.findByRole('tab', { name: /board/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to Backports and shows its own empty state', async () => {
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);
    await userEvent.click(await screen.findByRole('tab', { name: /backports/i }));
    expect(screen.getByText(/track a pull request/i)).toBeInTheDocument();
  });

  it('creates a group and polls its main PR in the same request as the board', async () => {
    const fetchImpl = boardResponder({ pr0: prNode(4821), pr1: prNode(4900) });
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: storedPrs(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);
    await screen.findByText('#4821');

    await userEvent.click(screen.getByRole('tab', { name: /backports/i }));
    await userEvent.click(screen.getByRole('button', { name: /track backports/i }));
    await userEvent.type(
      screen.getByLabelText(/main pull request/i),
      'https://github.com/Graylog2/graylog2-server/pull/4900',
    );
    await userEvent.click(screen.getByRole('button', { name: /^track$/i }));

    // One poll covers the board's #4821 and the group's main #4900.
    expect(await screen.findByText('#4900')).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(2); // mount poll, then the immediate poll on adding the group
  });

  it('fills a slot by dropping a link on it and the card updates on the next poll', async () => {
    const fetchImpl = boardResponder({
      pr0: prNode(4821),
      pr1: prNode(4840, { state: 'MERGED' }),
    });
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

    await userEvent.click(await screen.findByRole('tab', { name: /backports/i }));
    await userEvent.click(screen.getByRole('button', { name: /track backports/i }));
    await userEvent.type(
      screen.getByLabelText(/main pull request/i),
      'https://github.com/Graylog2/graylog2-server/pull/4821',
    );
    await userEvent.type(screen.getByLabelText(/backport to/i), '6.2');
    await userEvent.click(screen.getByRole('button', { name: /^track$/i }));

    const row = screen.getByTestId('slot-row');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(event, {
      dataTransfer: {
        types: ['text/plain'],
        getData: () => 'https://github.com/Graylog2/graylog2-server/pull/4840',
      },
    });
    row.dispatchEvent(event);

    expect(await screen.findByText(/merged/i)).toBeInTheDocument();
  });

  it('does not open the drop overlay while the Backports tab is active', async () => {
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);
    await userEvent.click(await screen.findByRole('tab', { name: /backports/i }));

    const event = new Event('dragenter', { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: { types: ['text/uri-list'], getData: () => '' } });
    window.dispatchEvent(event);

    expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument();
  });

  it('reports an unreadable stored backport-groups value without touching the board', async () => {
    const storage = fakeStorage({
      [TOKEN_KEY]: storedToken,
      [TRACKED_PRS_KEY]: storedPrs(4821),
      [BACKPORT_GROUPS_KEY]: 'not json{',
    });
    const fetchImpl = boardResponder({ pr0: prNode(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

    expect(await screen.findByText('#4821')).toBeInTheDocument();
    expect(screen.getByTestId('banner')).toHaveTextContent(/backport groups/i);
  });
});
```

Add the one new import this needs at the top of the file: `import { BACKPORT_GROUPS_KEY } from '../storage/backportGroups';`.

- [ ] **Step 3: Run the new tests to verify they fail**

```bash
npx vitest run src/ui/App.test.tsx
```

Expected: FAIL — the Backports-tab tests fail because `App` renders no tab bar yet; the existing tests continue to pass.

- [ ] **Step 4: Apply the eleven changes to `src/ui/App.tsx` described above**

Follow the numbered list precisely. Re-read the current file before each edit — its exact line numbers will have shifted from what is quoted above if earlier tasks in this plan already touched it (Task 6 did).

- [ ] **Step 5: Run everything**

```bash
npx vitest run src/ui/App.test.tsx
npx vitest run src/ui/TopBar.test.tsx
npm run typecheck
npm run build
npx vitest run
```

Expected: every existing `App.test.tsx` test still passes, unaltered; 6 new App-level tests pass; `TopBar.test.tsx` shows 5 passing (3 existing + 2 new); typecheck and build clean; full suite **366** — the 358 baseline from Task 12, plus 2 new `TopBar` tests, plus 6 new `App` tests.

- [ ] **Step 6: Manual verification against real GitHub**

This mirrors the v1 plan's Task 14 Step 7 — no agent can perform it. Run `npm run dev` and, with a real token and real PRs:

1. Switch to the Backports tab — it starts empty with a prompt.
2. Track a real PR's backports with two or three version labels.
3. Drag a real backport PR's link onto one of the slots — it fills and its merge status appears within a poll.
4. Paste a URL into a slot's inline input instead of dragging — same result.
5. Try to drop the same PR into a second slot in the same group — it is rejected with a message naming the slot it already fills.
6. Merge or close one of the tracked backport PRs on GitHub, wait for a poll, and confirm the slot's status and the roll-up count update.
7. Remove a version — its slot and PR disappear with no confirmation prompt.
8. Remove the whole group — it disappears; the board is unaffected.
9. Reload the page — the group and its filled slots are exactly as left.
10. Confirm dragging a link onto the window while the Backports tab is showing does **not** open the board's drop overlay, and confirm it still does on the Board tab.

- [ ] **Step 7: Commit**

```bash
git add src/ui/App.tsx src/ui/App.test.tsx src/ui/TopBar.tsx src/ui/TopBar.test.tsx
git commit -m "feat: wire the Backports tab into App with a unified poll and per-tab dragging"
```

---

## Verification

After Task 13, all of these must hold:

```bash
npm run test        # every suite green
npm run typecheck   # clean
npm run build        # clean
```

Plus the ten manual checks in Task 13 Step 6.

## Spec Coverage

| Spec section | Task |
| --- | --- |
| §2 Why a tab, not columns | 2 (no classify/badges/sort import), 13 (separate tab content) |
| §3 Scope, including what is deliberately out | all — nothing implements auto-discovery, CI/review signal, or reordering |
| §4 Independent lists, third key | 4, 5, 13 |
| §5 Data model, group identity, corrupt backup, zero-slot groups valid | 1, 4, 5 |
| §6 Version parsing, dedupe, order-preserving, editable later | 1, 5, 9 |
| §7 Slot status table including `pending`, no classify/badges reuse | 2, 8 |
| §8 Ordering: incomplete first, then recency | 2, 11 |
| §9 Polling: union targets, one request, existing backoff covers both tabs | 13 |
| §10.1 Tab bar with counts | 12, 13 |
| §10.2 Group card layout, roll-up, dimming | 9 |
| §10.3 Every slot a drop target, replace on refill, rejection naming the clash | 5, 8 |
| §10.4 Per-tab drag behaviour | 13 |
| §10.5 Create-group dialog, duplicate flash | 10, 13 |
| §10.6 Two empty states | 11 |
| §11 Error handling shared with v1, per-PR isolation | 2 (errored state), 13 (banner) |
| §12 Structure, `BoardTab` extraction | 3, 4, 6, all |
| §13 Testing | every task's own test file |
| §14 Deferred | — nothing implements auto-discovery, sorting, cross-tab awareness, or CI/review status |
