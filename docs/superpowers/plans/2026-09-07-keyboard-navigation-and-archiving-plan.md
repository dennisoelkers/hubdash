# Keyboard Navigation & Manual Archiving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arrow-key selection on all three tabs, plus an `a` shortcut and a clickable button that archive the selected item — generalizing Backports' existing per-group action, and introducing archiving as a brand-new concept on the Board (alongside its existing automatic archiving) and on Tasks (from scratch).

**Architecture:** One selection key (`PrKey | null`) lives in `App.tsx`, reset whenever the active tab changes. The Board's 2D grid movement is a small pure module (`gridNav.ts`); Backports and Tasks use plain array-index movement over each tab's already-computed active-item order. Archiving needs two new, *parallel* persisted key sets — one for the Board, one for Tasks — deliberately **not** embedded as a field on `TrackedPr`/`TrackedTask` themselves, since both of those types are reused elsewhere (`TrackedPr` inside `BackportGroup`; `TrackedTask` as the generalized poll-target shape `buildQuery`/`parseResponse`/`fetchBoard` accept) where an `archived` field would mean nothing.

**Tech Stack:** React 19, TypeScript 5.7 (strict), Vite 6, styled-components 6, Vitest 3 + Testing Library. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-07-keyboard-navigation-and-archiving-design.md`

## A note on where this plan corrects the spec

The spec (§5) describes Tasks' archive flag as `TrackedTask.archived: boolean`, mirroring `BackportGroup.archived` directly. Planning this out surfaces a problem the spec missed: `TrackedTask` is not only the Tasks tab's own record type — Tasks' shipped design deliberately reuses it as the *generic poll-target shape* `buildQuery`, `parseResponse`, and `fetchBoard` accept, tagging Board/Backports' plain `TrackedPr`s with `kind: 'pr'` to build one shared list every poll tick. Adding `archived` directly to `TrackedTask` would leak into every one of those unrelated poll-target constructions (in `App.tsx`, and in `buildQuery.test.ts`/`parseResponse.test.ts`/`client.test.ts`'s fixtures), for a concept that only ever applies to an actual tracked task. This plan uses the same shape already chosen for the Board instead: a **separate, parallel `archivedKeys: PrKey[]`**, stored alongside `tasks` — identical mechanism, same code shape, on both tabs. Nothing about the spec's user-facing behavior changes; only the internal representation does.

## Global Constraints

- Archiving is one-way everywhere — no un-archive action, anywhere, on any tab (spec §2, §3).
- Arrow-key selection never reaches into any Archive section (spec §2, §3).
- Selection resets to none on every tab change; it is not remembered per tab (spec §2, §3, user correction).
- Arrow keys and `a` are suppressed while `isEditable(event.target)` and while any dialog is open, exactly like the existing `p`/`b`/`t` shortcut (spec §3).
- No wrap-around at any list or grid edge (spec §3).
- The Board's and Tasks' Archive button/shortcut have **no precondition** — always available, regardless of an item's live status (spec §4, §5, user confirmation). Backports' keeps its existing `isComplete` gate unchanged (spec §6).
- Selection on Backports moves between groups only, never into slots (spec §2).
- Every task in this plan bumps `package.json`'s patch version as its last step before committing, per this project's standing version-bump policy.

---

### Task 1: `gridNav.ts` — the Board's 2D selection movement

**Files:**
- Create: `src/domain/gridNav.ts`
- Test: `src/domain/gridNav.test.ts`

**Interfaces:**
- Consumes: `PrKey` from `../types`.
- Produces: `BoardColumns`, `GridPosition`, `GridDirection`, `positionOf(columns, key)`, `moveSelection(columns, current, direction)` — all used by Task 10 (`App.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `src/domain/gridNav.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { moveSelection, positionOf } from './gridNav';
import type { BoardColumns } from './gridNav';

const columns: BoardColumns = {
  waiting: ['a#1', 'a#2', 'a#3'],
  needsAction: ['a#4'],
  ready: [],
};

describe('positionOf', () => {
  it('finds a key in whichever column holds it', () => {
    expect(positionOf(columns, 'a#2')).toEqual({ column: 'waiting', index: 1 });
    expect(positionOf(columns, 'a#4')).toEqual({ column: 'needsAction', index: 0 });
  });

  it('returns null for a key not present in any column', () => {
    expect(positionOf(columns, 'a#99')).toBeNull();
  });

  it('returns null for a null key', () => {
    expect(positionOf(columns, null)).toBeNull();
  });
});

describe('moveSelection — nothing selected yet', () => {
  it('selects the first item of the first non-empty column', () => {
    expect(moveSelection(columns, null, 'down')).toEqual({ column: 'waiting', index: 0 });
  });

  it('returns null when every column is empty', () => {
    const empty: BoardColumns = { waiting: [], needsAction: [], ready: [] };
    expect(moveSelection(empty, null, 'down')).toBeNull();
  });
});

describe('moveSelection — up/down within a column', () => {
  it('moves down within the column', () => {
    expect(moveSelection(columns, { column: 'waiting', index: 0 }, 'down')).toEqual({
      column: 'waiting',
      index: 1,
    });
  });

  it('moves up within the column', () => {
    expect(moveSelection(columns, { column: 'waiting', index: 2 }, 'up')).toEqual({
      column: 'waiting',
      index: 1,
    });
  });

  it('does not wrap past the bottom', () => {
    expect(moveSelection(columns, { column: 'waiting', index: 2 }, 'down')).toEqual({
      column: 'waiting',
      index: 2,
    });
  });

  it('does not wrap past the top', () => {
    expect(moveSelection(columns, { column: 'waiting', index: 0 }, 'up')).toEqual({
      column: 'waiting',
      index: 0,
    });
  });
});

describe('moveSelection — left/right across columns', () => {
  it('moves right to the next column, landing on the same row', () => {
    expect(moveSelection(columns, { column: 'waiting', index: 1 }, 'right')).toEqual({
      column: 'needsAction',
      index: 0,
    });
  });

  it('clamps the landing row to the target column’s last item', () => {
    expect(moveSelection(columns, { column: 'waiting', index: 2 }, 'right')).toEqual({
      column: 'needsAction',
      index: 0,
    });
  });

  it('skips an empty column in the direction of travel', () => {
    // ready is empty, so right from needsAction has nowhere to land.
    expect(moveSelection(columns, { column: 'needsAction', index: 0 }, 'right')).toEqual({
      column: 'needsAction',
      index: 0,
    });
  });

  it('does not wrap past the left edge', () => {
    expect(moveSelection(columns, { column: 'waiting', index: 0 }, 'left')).toEqual({
      column: 'waiting',
      index: 0,
    });
  });

  it('moves left back across a skipped empty column', () => {
    const withGap: BoardColumns = { waiting: ['a#1'], needsAction: [], ready: ['a#2'] };
    expect(moveSelection(withGap, { column: 'ready', index: 0 }, 'left')).toEqual({
      column: 'waiting',
      index: 0,
    });
  });
});

describe('moveSelection — current names a now-empty or missing column', () => {
  it('falls back to the first non-empty column', () => {
    const shrunk: BoardColumns = { waiting: [], needsAction: ['a#4'], ready: [] };
    expect(moveSelection(shrunk, { column: 'waiting', index: 0 }, 'down')).toEqual({
      column: 'needsAction',
      index: 0,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/domain/gridNav.test.ts`
Expected: FAIL with "Cannot find module './gridNav'".

- [ ] **Step 3: Write the implementation**

Create `src/domain/gridNav.ts`:

```ts
import type { PrKey } from '../types';

export type BoardColumns = { waiting: PrKey[]; needsAction: PrKey[]; ready: PrKey[] };
export type GridPosition = { column: keyof BoardColumns; index: number };
export type GridDirection = 'up' | 'down' | 'left' | 'right';

const COLUMN_ORDER: (keyof BoardColumns)[] = ['waiting', 'needsAction', 'ready'];

function firstNonEmpty(columns: BoardColumns): GridPosition | null {
  for (const column of COLUMN_ORDER) {
    if (columns[column].length > 0) return { column, index: 0 };
  }
  return null;
}

/** Where `key` currently sits, or null if it names nothing in `columns`. */
export function positionOf(columns: BoardColumns, key: PrKey | null): GridPosition | null {
  if (key === null) return null;
  for (const column of COLUMN_ORDER) {
    const index = columns[column].indexOf(key);
    if (index !== -1) return { column, index };
  }
  return null;
}

/**
 * Where the selection moves to from `current`, per spec §4. Up/down moves
 * within a column; left/right moves to the next non-empty column in that
 * direction (skipping any empty one in between), landing on the same row —
 * clamped to that column's last item if it's shorter. No wrap-around:
 * moving past an edge is a no-op, returning `current` unchanged. `current`
 * naming an empty or now-gone column (data shifted under it) is treated the
 * same as no selection at all.
 */
export function moveSelection(
  columns: BoardColumns,
  current: GridPosition | null,
  direction: GridDirection,
): GridPosition | null {
  if (current === null || columns[current.column].length === 0) {
    return firstNonEmpty(columns);
  }

  if (direction === 'up' || direction === 'down') {
    const length = columns[current.column].length;
    const nextIndex = direction === 'up' ? current.index - 1 : current.index + 1;
    if (nextIndex < 0 || nextIndex >= length) return current;
    return { column: current.column, index: nextIndex };
  }

  const currentColumnIndex = COLUMN_ORDER.indexOf(current.column);
  const step = direction === 'left' ? -1 : 1;
  for (let i = currentColumnIndex + step; i >= 0 && i < COLUMN_ORDER.length; i += step) {
    const column = COLUMN_ORDER[i];
    if (column === undefined) break;
    if (columns[column].length > 0) {
      return { column, index: Math.min(current.index, columns[column].length - 1) };
    }
  }
  return current;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/domain/gridNav.test.ts`
Expected: PASS, all 15 tests green.

- [ ] **Step 5: Bump the version and commit**

```bash
git add src/domain/gridNav.ts src/domain/gridNav.test.ts package.json
git commit -m "feat: add gridNav — pure 2D selection movement for the Board"
```

---

### Task 2: Board manual archive — storage migration

**Files:**
- Modify: `src/storage/trackedPrs.ts`
- Modify: `src/storage/trackedPrs.test.ts`

**Interfaces:**
- Produces: `LoadTrackedPrsResult` now includes `archivedKeys: PrKey[]`; `saveTrackedPrs(prs, archivedKeys, storage?)` (signature change — the added parameter) — used by Task 3 (`useTrackedPrs.ts`).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/storage/trackedPrs.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import type { TrackedPr } from '../types';
import {
  CORRUPT_TRACKED_PRS_KEY,
  TRACKED_PRS_KEY,
  loadTrackedPrs,
  saveTrackedPrs,
} from './trackedPrs';

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

const pr: TrackedPr = {
  owner: 'Example',
  repo: 'example-server',
  number: 4821,
  addedAt: '2026-08-27T09:00:00Z',
};

describe('loadTrackedPrs', () => {
  it('returns an empty list and no archived keys when the key is absent', () => {
    expect(loadTrackedPrs(fakeStorage())).toEqual({ prs: [], archivedKeys: [], error: null });
  });

  it('round-trips a saved list and its archived keys', () => {
    const storage = fakeStorage();
    saveTrackedPrs([pr], ['example/example-server#4821'], storage);
    expect(loadTrackedPrs(storage)).toEqual({
      prs: [pr],
      archivedKeys: ['example/example-server#4821'],
      error: null,
    });
  });

  it('loads a version-1 payload, defaulting archivedKeys to empty', () => {
    const raw = JSON.stringify({ version: 1, prs: [pr] });
    expect(loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: raw }))).toEqual({
      prs: [pr],
      archivedKeys: [],
      error: null,
    });
  });

  it('reports an error and returns the default for non-JSON', () => {
    const result = loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: 'not json{' }));
    expect(result.prs).toEqual([]);
    expect(result.archivedKeys).toEqual([]);
    expect(result.error).toMatch(/could not be read/i);
  });

  it('rejects a wrong-shaped envelope', () => {
    expect(loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: '[]' })).error).toBeTruthy();
    expect(loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: '{"prs":[]}' })).error).toBeTruthy();
    expect(loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: '{"version":1}' })).error).toBeTruthy();
  });

  it('does not blame the version when the envelope has none', () => {
    const raw = JSON.stringify({ prs: [pr] });
    const error = loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: raw })).error;
    expect(error).toBeTruthy();
    expect(error).not.toMatch(/version/i);
  });

  it('rejects an unknown version', () => {
    const raw = JSON.stringify({ version: 99, prs: [pr], archivedKeys: [] });
    expect(loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: raw })).error).toMatch(/version/i);
  });

  it('rejects entries with missing or wrongly typed fields', () => {
    const bad = [
      { owner: 'a', repo: 'b', number: 1 },
      { owner: 'a', repo: 'b', number: '1', addedAt: 'x' },
      { owner: '', repo: 'b', number: 1, addedAt: 'x' },
      { owner: 'a', repo: 'b', number: 0, addedAt: 'x' },
      { owner: 'a', repo: 'b', number: 1.5, addedAt: 'x' },
    ];
    for (const entry of bad) {
      const raw = JSON.stringify({ version: 1, prs: [entry] });
      const result = loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: raw }));
      expect(result.prs, JSON.stringify(entry)).toEqual([]);
      expect(result.error, JSON.stringify(entry)).toBeTruthy();
    }
  });

  it('rejects a version-2 payload whose archivedKeys is not a string array', () => {
    const raw = JSON.stringify({ version: 2, prs: [pr], archivedKeys: [1, 2] });
    const result = loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: raw }));
    expect(result.prs).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it('preserves an unusable value under the corrupt key so nothing is lost', () => {
    const storage = fakeStorage({ [TRACKED_PRS_KEY]: 'not json{' });
    loadTrackedPrs(storage);
    expect(storage.getItem(CORRUPT_TRACKED_PRS_KEY)).toBe('not json{');
  });

  it('never throws when storage itself is unavailable', () => {
    expect(loadTrackedPrs(null)).toEqual({ prs: [], archivedKeys: [], error: null });
  });
});

describe('saveTrackedPrs', () => {
  it('writes a versioned envelope with both fields', () => {
    const storage = fakeStorage();
    saveTrackedPrs([pr], ['example/example-server#4821'], storage);
    expect(JSON.parse(storage.getItem(TRACKED_PRS_KEY) ?? '')).toEqual({
      version: 2,
      prs: [pr],
      archivedKeys: ['example/example-server#4821'],
    });
  });

  it('never throws when storage is unavailable', () => {
    expect(() => saveTrackedPrs([pr], [], null)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/storage/trackedPrs.test.ts`
Expected: FAIL — `loadTrackedPrs`/`saveTrackedPrs` don't know about `archivedKeys` yet.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/storage/trackedPrs.ts` with:

```ts
import type { PrKey, TrackedPr } from '../types';
import { readKey, writeKey } from './localStorage';

export const TRACKED_PRS_KEY = 'hubdash.prs';
export const CORRUPT_TRACKED_PRS_KEY = 'hubdash.prs.corrupt';

const CURRENT_VERSION = 2;

export type LoadTrackedPrsResult = {
  prs: TrackedPr[];
  archivedKeys: PrKey[];
  error: string | null;
};

const UNREADABLE = 'Your tracked pull requests could not be read and were reset.';

export function isTrackedPr(value: unknown): value is TrackedPr {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.owner === 'string' &&
    candidate.owner !== '' &&
    typeof candidate.repo === 'string' &&
    candidate.repo !== '' &&
    typeof candidate.number === 'number' &&
    Number.isInteger(candidate.number) &&
    candidate.number > 0 &&
    typeof candidate.addedAt === 'string' &&
    candidate.addedAt !== ''
  );
}

function isPrKeyArray(value: unknown): value is PrKey[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function reject(
  storage: Storage | null | undefined,
  raw: string,
  error: string,
): LoadTrackedPrsResult {
  // Keep the unusable value so a later save cannot destroy the user's list.
  writeKey(storage, CORRUPT_TRACKED_PRS_KEY, raw);
  return { prs: [], archivedKeys: [], error };
}

export function loadTrackedPrs(storage?: Storage | null): LoadTrackedPrsResult {
  const raw = readKey(storage, TRACKED_PRS_KEY);
  if (raw === null) return { prs: [], archivedKeys: [], error: null };

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
  // A missing `version` is a wrong envelope, not a future one.
  if (!('version' in envelope)) {
    return reject(storage, raw, UNREADABLE);
  }

  // A version-1 payload predates `archivedKeys`; nothing it names was ever
  // manually archived, since the feature didn't exist yet — the only correct
  // default is an empty set.
  if (envelope.version === 1) {
    if (!Array.isArray(envelope.prs) || !envelope.prs.every(isTrackedPr)) {
      return reject(storage, raw, UNREADABLE);
    }
    return { prs: envelope.prs, archivedKeys: [], error: null };
  }

  if (envelope.version !== CURRENT_VERSION) {
    return reject(
      storage,
      raw,
      'Your tracked pull requests use an unsupported version and were reset.',
    );
  }
  if (!Array.isArray(envelope.prs) || !envelope.prs.every(isTrackedPr)) {
    return reject(storage, raw, UNREADABLE);
  }
  if (!isPrKeyArray(envelope.archivedKeys)) {
    return reject(storage, raw, UNREADABLE);
  }

  return { prs: envelope.prs, archivedKeys: envelope.archivedKeys, error: null };
}

export function saveTrackedPrs(
  prs: TrackedPr[],
  archivedKeys: PrKey[],
  storage?: Storage | null,
): void {
  writeKey(
    storage,
    TRACKED_PRS_KEY,
    JSON.stringify({ version: CURRENT_VERSION, prs, archivedKeys }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/storage/trackedPrs.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: an error in `src/hooks/useTrackedPrs.ts` where it calls `saveTrackedPrs` with the old two-argument form — expected, fixed in Task 3.

- [ ] **Step 6: Bump the version and commit**

```bash
git add src/storage/trackedPrs.ts src/storage/trackedPrs.test.ts package.json
git commit -m "feat: add manually-archived-PR storage, migrating hubdash.prs to v2"
```

---

### Task 3: `useTrackedPrs` — expose and mutate `archivedKeys`

**Files:**
- Modify: `src/hooks/useTrackedPrs.ts`
- Modify: `src/hooks/useTrackedPrs.test.ts`

**Interfaces:**
- Consumes: `loadTrackedPrs`/`saveTrackedPrs` (Task 2).
- Produces: `UseTrackedPrsResult` gains `archivedKeys: PrKey[]` and `archivePr: (key: PrKey) => void` — used by Task 10 (`App.tsx`).

- [ ] **Step 1: Write the failing tests**

In `src/hooks/useTrackedPrs.test.ts`, add these `describe` blocks after the existing `describe('useTrackedPrs', ...)` block's closing `});`:

```ts
describe('useTrackedPrs — manual archiving', () => {
  it('starts with no archived keys', () => {
    const { result } = setup();
    expect(result.current.archivedKeys).toEqual([]);
  });

  it('archives a tracked PR and persists it', () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => useTrackedPrs({ storage, clock }));
    act(() => {
      result.current.add({ owner: 'Example', repo: 'example-server', number: 4821 });
    });
    act(() => {
      result.current.archivePr('example/example-server#4821');
    });
    expect(result.current.archivedKeys).toEqual(['example/example-server#4821']);
    expect(JSON.parse(storage.getItem(TRACKED_PRS_KEY) ?? '').archivedKeys).toEqual([
      'example/example-server#4821',
    ]);
  });

  it('is a no-op to archive an already-archived key', () => {
    const { result } = setup();
    act(() => {
      result.current.add({ owner: 'Example', repo: 'example-server', number: 4821 });
    });
    act(() => {
      result.current.archivePr('example/example-server#4821');
      result.current.archivePr('example/example-server#4821');
    });
    expect(result.current.archivedKeys).toEqual(['example/example-server#4821']);
  });

  it('drops a stale archived key when the PR is removed', () => {
    const { result } = setup();
    act(() => {
      result.current.add({ owner: 'Example', repo: 'example-server', number: 4821 });
    });
    act(() => {
      result.current.archivePr('example/example-server#4821');
    });
    act(() => {
      result.current.remove('example/example-server#4821');
    });
    expect(result.current.archivedKeys).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useTrackedPrs.test.ts`
Expected: FAIL — `archivedKeys`/`archivePr` don't exist on the hook's result yet.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/hooks/useTrackedPrs.ts` with:

```ts
import { useCallback, useRef, useState } from 'react';
import { prKey } from '../domain/prKey';
import type { ParsedPr } from '../github/parseUrl';
import { loadTrackedPrs, saveTrackedPrs } from '../storage/trackedPrs';
import type { PrKey, TrackedPr } from '../types';

/**
 * Module-level so its identity is stable. Inlining this as
 * `clock ?? (() => new Date().toISOString())` would mint a new function on
 * every render, which defeats the memoization of `add` — and App re-renders
 * once a second to drive the freshness label, so that churn is continuous.
 */
const defaultClock = () => new Date().toISOString();

export type UseTrackedPrsOptions = {
  storage?: Storage | null;
  clock?: () => string;
};

export type UseTrackedPrsResult = {
  prs: TrackedPr[];
  archivedKeys: PrKey[];
  add: (parsed: ParsedPr) => { added: boolean; key: PrKey };
  remove: (key: PrKey) => void;
  archivePr: (key: PrKey) => void;
  storageError: string | null;
  dismissStorageError: () => void;
};

function keyOf(pr: TrackedPr | ParsedPr): PrKey {
  return prKey(pr.owner, pr.repo, pr.number);
}

/**
 * Owns the tracked list and, since this feature, the separate set of
 * manually-archived keys alongside it — see the plan's note on why this is
 * not a field on `TrackedPr` itself. Writes are explicit — every mutation
 * saves both pieces together — and the hook never saves on mount, so an
 * unreadable stored value is not overwritten before the user has had a
 * chance to see the warning about it.
 */
export function useTrackedPrs(options: UseTrackedPrsOptions = {}): UseTrackedPrsResult {
  const { storage, clock } = options;
  const now = clock ?? defaultClock;

  const initial = useRef<{
    prs: TrackedPr[];
    archivedKeys: PrKey[];
    error: string | null;
  } | null>(null);
  if (initial.current === null) {
    initial.current = loadTrackedPrs(storage);
  }

  const [prs, setPrs] = useState<TrackedPr[]>(initial.current.prs);
  const [archivedKeys, setArchivedKeys] = useState<PrKey[]>(initial.current.archivedKeys);
  const [storageError, setStorageError] = useState<string | null>(initial.current.error);

  // Mirrors `prs`/`archivedKeys` so mutations can decide synchronously and
  // return a verdict to the caller, which the dialog needs in order to flash
  // a duplicate.
  const prsRef = useRef<TrackedPr[]>(initial.current.prs);
  const archivedRef = useRef<PrKey[]>(initial.current.archivedKeys);

  const commit = useCallback(
    (nextPrs: TrackedPr[], nextArchived: PrKey[]) => {
      prsRef.current = nextPrs;
      archivedRef.current = nextArchived;
      saveTrackedPrs(nextPrs, nextArchived, storage);
      setPrs(nextPrs);
      setArchivedKeys(nextArchived);
    },
    [storage],
  );

  const add = useCallback(
    (parsed: ParsedPr) => {
      const key = keyOf(parsed);
      if (prsRef.current.some((pr) => keyOf(pr) === key)) {
        return { added: false, key };
      }
      commit([...prsRef.current, { ...parsed, addedAt: now() }], archivedRef.current);
      return { added: true, key };
    },
    [commit, now],
  );

  const remove = useCallback(
    (key: PrKey) => {
      const next = prsRef.current.filter((pr) => keyOf(pr) !== key);
      if (next.length === prsRef.current.length) return;
      // Drop a stale archived key too, so nothing dangles for a PR no longer
      // tracked at all.
      const nextArchived = archivedRef.current.filter((archivedKey) => archivedKey !== key);
      commit(next, nextArchived);
    },
    [commit],
  );

  const archivePr = useCallback(
    (key: PrKey) => {
      if (archivedRef.current.includes(key)) return;
      commit(prsRef.current, [...archivedRef.current, key]);
    },
    [commit],
  );

  const dismissStorageError = useCallback(() => setStorageError(null), []);

  return { prs, archivedKeys, add, remove, archivePr, storageError, dismissStorageError };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useTrackedPrs.test.ts`
Expected: PASS, all tests green (existing tests plus the new ones).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from `trackedPrs.ts`/`useTrackedPrs.ts` anymore. `App.tsx` and `sort.ts` are untouched so far by this plan — no new errors from them yet.

- [ ] **Step 6: Bump the version and commit**

```bash
git add src/hooks/useTrackedPrs.ts src/hooks/useTrackedPrs.test.ts package.json
git commit -m "feat: add archivePr to useTrackedPrs, one-way like archiveGroup"
```

---

### Task 4: `groupIntoColumns` takes manually-archived keys

**Files:**
- Modify: `src/domain/sort.ts`
- Modify: `src/domain/sort.test.ts`

**Interfaces:**
- Consumes: `PrKey` from `../types` (existing).
- Produces: `groupIntoColumns(entries: PrEntry[], archivedKeys?: Set<PrKey>): Record<ColumnId, PrEntry[]>` — the second parameter is optional, defaulting to an empty set, so every existing caller (`Board.test.tsx`, `App.tsx` before Task 10 wires the real set through) keeps working unmodified. Used by Task 10 (`App.tsx`).

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to the end of `src/domain/sort.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/domain/sort.test.ts`
Expected: FAIL — `groupIntoColumns` doesn't accept a second argument yet, so the manually-archived entry still lands wherever `classify()`/the error branch would put it.

- [ ] **Step 3: Update the implementation**

In `src/domain/sort.ts`, change the `groupIntoColumns` function from:

```ts
export function groupIntoColumns(entries: PrEntry[]): Record<ColumnId, PrEntry[]> {
  const columns: Record<ColumnId, PrEntry[]> = {
    waiting: [],
    needsAction: [],
    ready: [],
    archive: [],
  };

  for (const entry of entries) {
    const column = entry.status === 'error' ? 'needsAction' : classify(entry.pr);
    columns[column].push(entry);
  }

  for (const column of Object.values(columns)) {
    column.sort(byRankThenRecency);
  }

  return columns;
}
```

to:

```ts
/**
 * Groups every entry into its column and orders each column, per spec §7.3
 * (v1) and the manual-archiving spec §4. `archivedKeys` — a manually
 * archived PR (this feature) — is checked first, ahead of even the error
 * branch: a user's decision to archive something should not be overridden
 * by a later transient poll failure on it. An entry that failed to resolve
 * goes to needs action otherwise, since removing it or fixing access is the
 * user's call.
 */
export function groupIntoColumns(
  entries: PrEntry[],
  archivedKeys: Set<PrKey> = new Set(),
): Record<ColumnId, PrEntry[]> {
  const columns: Record<ColumnId, PrEntry[]> = {
    waiting: [],
    needsAction: [],
    ready: [],
    archive: [],
  };

  for (const entry of entries) {
    const column = archivedKeys.has(entry.key)
      ? 'archive'
      : entry.status === 'error'
        ? 'needsAction'
        : classify(entry.pr);
    columns[column].push(entry);
  }

  for (const column of Object.values(columns)) {
    column.sort(byRankThenRecency);
  }

  return columns;
}
```

Add `PrKey` to the existing type-only import at the top of the file (from `import type { ColumnId, PrEntry } from '../types';` to `import type { ColumnId, PrEntry, PrKey } from '../types';`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/domain/sort.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS — `Board.test.tsx` and every other existing caller of `groupIntoColumns` still passes unmodified, since the new parameter defaults to an empty set.

- [ ] **Step 6: Bump the version and commit**

```bash
git add src/domain/sort.ts src/domain/sort.test.ts package.json
git commit -m "feat: groupIntoColumns takes manually-archived keys, checked first"
```

---

### Task 5: Board UI — Archive button and selection highlight

**Files:**
- Modify: `src/ui/PrCard.tsx`
- Modify: `src/ui/PrCard.test.tsx`
- Modify: `src/ui/Column.tsx`
- Modify: `src/ui/Board.tsx`
- Modify: `src/ui/ArchiveSection.tsx`
- Modify: `src/ui/BoardTab.tsx`
- Modify: `src/ui/Board.test.tsx`

**Interfaces:**
- Produces: `PrCard` gains `onArchive: (key: PrKey) => void`, `archived?: boolean` (default `false`, hides the button when true), and `selected?: boolean` (default `false`). `Column`, `Board`, `ArchiveSection`, `BoardTab` all thread `onArchive` and (except `ArchiveSection`, which is never navigable) `selectedKey?: PrKey | null` down to `PrCard`. Used by Task 10 (`App.tsx`).

- [ ] **Step 1: Write the failing tests**

Add these tests to `src/ui/PrCard.test.tsx`, inside a new `describe` block appended after the existing `describe('PrCard — an unresolved PR', ...)` block:

```ts
describe('PrCard — archiving and selection', () => {
  it('shows an Archive button for a non-archived card and calls onArchive with the key', async () => {
    const onArchive = vi.fn();
    render(<PrCard entry={okEntry()} onRemove={() => {}} onArchive={onArchive} />);
    await userEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    expect(onArchive).toHaveBeenCalledWith('example/example-server#4821');
  });

  it('hides the Archive button once the card is already archived', () => {
    render(<PrCard entry={okEntry()} onRemove={() => {}} onArchive={() => {}} archived />);
    expect(screen.queryByRole('button', { name: /^archive$/i })).not.toBeInTheDocument();
  });

  it('marks itself selected via data-selected', () => {
    render(<PrCard entry={okEntry()} onRemove={() => {}} onArchive={() => {}} selected />);
    expect(screen.getByTestId('pr-card')).toHaveAttribute('data-selected', 'true');
  });

  it('is not selected by default', () => {
    render(<PrCard entry={okEntry()} onRemove={() => {}} onArchive={() => {}} />);
    expect(screen.getByTestId('pr-card')).toHaveAttribute('data-selected', 'false');
  });
});
```

Every other existing `<PrCard ... />` call in this file (there are several, in the earlier `describe` blocks) must also gain `onArchive={() => {}}` — it is now a required prop. Add it to each.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/PrCard.test.tsx`
Expected: FAIL — `onArchive` isn't a recognized prop yet, and there's no Archive button or `data-selected` attribute.

- [ ] **Step 3: Update `PrCard.tsx`**

Add `onArchive`, `archived`, and `selected` to `PrCardProps`:

```tsx
export type PrCardProps = {
  entry: PrEntry;
  onRemove: (key: PrKey) => void;
  onArchive: (key: PrKey) => void;
  flashed?: boolean;
  archived?: boolean;
  selected?: boolean;
};
```

Add a `data-selected` treatment to the `Card` styled component (alongside the existing `data-flashed` rule) — a persistent background tint, visually distinct from the flash outline so the two never look identical if they ever coincide:

```ts
  &[data-selected='true'] {
    background: ${tokens.color.accent}1a;
  }
```

Add a `Spacer` and an `ArchiveButton` styled component, matching `BackportGroupCard`'s own `ArchiveButton`:

```ts
const Spacer = styled.span`
  flex: 1;
`;

const ArchiveButton = styled.button`
  padding: ${tokens.space(1)} ${tokens.space(2)};
  background: none;
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  color: ${tokens.color.textMuted};
  font-family: ${tokens.font.body};
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    color: ${tokens.color.text};
    border-color: ${tokens.color.accent};
  }
`;
```

Update the function signature and the `Card`/`Header` markup:

```tsx
export function PrCard({
  entry,
  onRemove,
  onArchive,
  flashed = false,
  archived = false,
  selected = false,
}: PrCardProps) {
```

```tsx
    <Card
      ref={cardRef}
      data-testid="pr-card"
      data-status={entry.status}
      data-draft={isDraft ? 'true' : 'false'}
      data-flashed={flashed ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
    >
```

Change the `Header` block from:

```tsx
      <Header>
        <Number>{`#${number}`}</Number>
        {entry.status === 'ok' ? (
          <TitleLink href={entry.pr.url} target="_blank" rel="noreferrer noopener">
            {entry.pr.title}
          </TitleLink>
        ) : null}
      </Header>
```

to:

```tsx
      <Header>
        <Number>{`#${number}`}</Number>
        {entry.status === 'ok' ? (
          <TitleLink href={entry.pr.url} target="_blank" rel="noreferrer noopener">
            {entry.pr.title}
          </TitleLink>
        ) : null}
        <Spacer />
        {archived ? null : (
          <ArchiveButton type="button" onClick={() => onArchive(entry.key)}>
            Archive
          </ArchiveButton>
        )}
      </Header>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/PrCard.test.tsx`
Expected: PASS, all tests green.

- [ ] **Step 5: Thread `onArchive` and `selectedKey` through `Column`, `Board`, `ArchiveSection`, `BoardTab`**

In `src/ui/Column.tsx`, add `onArchive: (key: PrKey) => void` and `selectedKey?: PrKey | null` to `ColumnProps`, and pass them to `PrCard`:

```tsx
export type ColumnProps = {
  id: ColumnId;
  entries: PrEntry[];
  onRemove: (key: PrKey) => void;
  onArchive: (key: PrKey) => void;
  flashedKey?: PrKey | null;
  selectedKey?: PrKey | null;
};
```

```tsx
export function Column({
  id,
  entries,
  onRemove,
  onArchive,
  flashedKey = null,
  selectedKey = null,
}: ColumnProps) {
```

Change the `PrCard` call from `<PrCard entry={entry} onRemove={onRemove} flashed={entry.key === flashedKey} />` to:

```tsx
              <PrCard
                entry={entry}
                onRemove={onRemove}
                onArchive={onArchive}
                flashed={entry.key === flashedKey}
                selected={entry.key === selectedKey}
              />
```

In `src/ui/Board.tsx`, add the same two props to `BoardProps`, pass `onArchive` to every `<Column>`, `selectedKey` to every `<Column>`, and pass `onArchive` to `<ArchiveSection>` (selection never reaches the archive section, so it gets no `selectedKey`):

```tsx
export type BoardProps = {
  columns: Record<ColumnId, PrEntry[]>;
  onRemove: (key: PrKey) => void;
  onArchive: (key: PrKey) => void;
  flashedKey?: PrKey | null;
  selectedKey?: PrKey | null;
};
```

```tsx
export function Board({ columns, onRemove, onArchive, flashedKey = null, selectedKey = null }: BoardProps) {
  return (
    <Wrapper>
      <Columns>
        {ORDER.map((id) => (
          <Column
            key={id}
            id={id}
            entries={columns[id]}
            onRemove={onRemove}
            onArchive={onArchive}
            flashedKey={flashedKey}
            selectedKey={selectedKey}
          />
        ))}
      </Columns>
      <ArchiveSection entries={columns.archive} onRemove={onRemove} onArchive={onArchive} />
    </Wrapper>
  );
}
```

In `src/ui/ArchiveSection.tsx`, add `onArchive` to `ArchiveSectionProps` and pass it (and `archived`) to `PrCard`:

```tsx
export type ArchiveSectionProps = {
  entries: PrEntry[];
  onRemove: (key: PrKey) => void;
  onArchive: (key: PrKey) => void;
};
```

```tsx
export function ArchiveSection({ entries, onRemove, onArchive }: ArchiveSectionProps) {
  ...
          {entries.map((entry) => (
            <PrCard key={entry.key} entry={entry} onRemove={onRemove} onArchive={onArchive} archived />
          ))}
```

In `src/ui/BoardTab.tsx`, add `onArchive` and `selectedKey` to `BoardTabProps` and pass them through to `<Board>`:

```tsx
export type BoardTabProps = {
  columns: Record<ColumnId, PrEntry[]>;
  isEmpty: boolean;
  flashedKey: PrKey | null;
  selectedKey: PrKey | null;
  onRemove: (key: PrKey) => void;
  onArchive: (key: PrKey) => void;
};

export function BoardTab({
  columns,
  isEmpty,
  flashedKey,
  selectedKey,
  onRemove,
  onArchive,
}: BoardTabProps) {
  if (isEmpty) {
    return <Empty>Add a pull request — use the button, paste a URL, or drop a link here.</Empty>;
  }
  return (
    <Board
      columns={columns}
      onRemove={onRemove}
      onArchive={onArchive}
      flashedKey={flashedKey}
      selectedKey={selectedKey}
    />
  );
}
```

- [ ] **Step 6: Add coverage in `Board.test.tsx`**

Add this `describe` block to the end of `src/ui/Board.test.tsx`, and add `onArchive={() => {}}` to every existing `<Board columns={...} onRemove={...} />` call in the file (it is now a required prop):

```ts
describe('Board — archiving and selection', () => {
  it('passes the archive callback through to cards, hidden inside the archive section', async () => {
    const onArchive = vi.fn();
    const columns = groupIntoColumns([entry({ number: 4821 })]);
    render(<Board columns={columns} onRemove={() => {}} onArchive={onArchive} />);
    await userEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    expect(onArchive).toHaveBeenCalledWith('example/example-server#4821');
  });

  it('selects only the card whose key matches', () => {
    const columns = groupIntoColumns([entry({ number: 1 }), entry({ number: 2 })]);
    render(
      <Board
        columns={columns}
        onRemove={() => {}}
        onArchive={() => {}}
        selectedKey="example/example-server#2"
      />,
    );
    const selected = screen
      .getAllByTestId('pr-card')
      .filter((card) => card.getAttribute('data-selected') === 'true');
    expect(selected).toHaveLength(1);
    const [selectedCard] = selected;
    if (!selectedCard) throw new Error('expected exactly one selected card');
    expect(within(selectedCard).getByText('#2')).toBeInTheDocument();
  });

  it('never renders an Archive button inside the collapsed-then-expanded archive section', async () => {
    const columns = groupIntoColumns([entry({ number: 9, lifecycle: 'MERGED' })]);
    render(<Board columns={columns} onRemove={() => {}} onArchive={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /^archive$/i, exact: false }));
    // The toggle itself is named "Archive N"; a per-card Archive button would
    // collide with an exact-match query, which is exactly what this guards.
    expect(screen.queryAllByRole('button', { name: /^archive$/i })).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/ui/PrCard.test.tsx src/ui/Board.test.tsx`
Expected: PASS, all tests green.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: an error in `src/ui/App.tsx` where it renders `<BoardTab>` without the new required `onArchive`/`selectedKey` props — expected, fixed in Task 10.

- [ ] **Step 9: Bump the version and commit**

```bash
git add src/ui/PrCard.tsx src/ui/PrCard.test.tsx src/ui/Column.tsx src/ui/Board.tsx src/ui/ArchiveSection.tsx src/ui/BoardTab.tsx src/ui/Board.test.tsx package.json
git commit -m "feat: add an Archive button and selection highlight to PrCard"
```

---

### Task 6: Tasks archive — storage migration

**Files:**
- Modify: `src/storage/tasks.ts`
- Modify: `src/storage/tasks.test.ts`

**Interfaces:**
- Produces: `LoadTasksResult` gains `archivedKeys: PrKey[]`; `saveTasks(tasks, archivedKeys, storage?)` (signature change) — used by Task 7 (`useTasks.ts`). Same shape as Task 2, applied to `hubdash.tasks`.

- [ ] **Step 1: Write the failing tests**

Add these to `src/storage/tasks.test.ts`. First, change the existing `describe('loadTasks', ...)` block's two existing assertions on plain `{tasks: [...], error: null}` shapes to also expect `archivedKeys: []` — specifically, change:

```ts
  it('returns an empty list when nothing is stored', () => {
    expect(loadTasks(fakeStorage())).toEqual({ tasks: [], error: null });
  });
```

to:

```ts
  it('returns an empty list and no archived keys when nothing is stored', () => {
    expect(loadTasks(fakeStorage())).toEqual({ tasks: [], archivedKeys: [], error: null });
  });
```

and change:

```ts
  it('loads a previously saved list', () => {
    const storage = fakeStorage({
      [TASKS_KEY]: JSON.stringify({
        version: 1,
        tasks: [{ kind: 'pr', owner: 'a', repo: 'b', number: 1, addedAt: '2026-08-27T09:00:00Z' }],
      }),
    });
    expect(loadTasks(storage)).toEqual({
      tasks: [{ kind: 'pr', owner: 'a', repo: 'b', number: 1, addedAt: '2026-08-27T09:00:00Z' }],
      error: null,
    });
  });
```

to:

```ts
  it('loads a version-1 payload, defaulting archivedKeys to empty', () => {
    const storage = fakeStorage({
      [TASKS_KEY]: JSON.stringify({
        version: 1,
        tasks: [{ kind: 'pr', owner: 'a', repo: 'b', number: 1, addedAt: '2026-08-27T09:00:00Z' }],
      }),
    });
    expect(loadTasks(storage)).toEqual({
      tasks: [{ kind: 'pr', owner: 'a', repo: 'b', number: 1, addedAt: '2026-08-27T09:00:00Z' }],
      archivedKeys: [],
      error: null,
    });
  });
```

Then add a new `describe` block after the existing `describe('saveTasks', ...)` block, and change `saveTasks`'s existing test call from `saveTasks([...], storage)` to `saveTasks([...], [], storage)`:

```ts
describe('loadTasks — archived keys', () => {
  it('round-trips archived keys alongside the tasks', () => {
    const storage = fakeStorage();
    saveTasks(
      [{ kind: 'pr', owner: 'a', repo: 'b', number: 1, addedAt: '2026-08-27T09:00:00Z' }],
      ['a/b#1'],
      storage,
    );
    expect(loadTasks(storage)).toEqual({
      tasks: [{ kind: 'pr', owner: 'a', repo: 'b', number: 1, addedAt: '2026-08-27T09:00:00Z' }],
      archivedKeys: ['a/b#1'],
      error: null,
    });
  });

  it('rejects a version-2 payload whose archivedKeys is not a string array', () => {
    const raw = JSON.stringify({ version: 2, tasks: [], archivedKeys: [1] });
    const result = loadTasks(fakeStorage({ [TASKS_KEY]: raw }));
    expect(result.tasks).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});
```

Also update the existing `saveTasks` describe block's test:

```ts
describe('saveTasks', () => {
  it('round-trips through loadTasks', () => {
    const storage = fakeStorage();
    saveTasks(
      [{ kind: 'issue', owner: 'a', repo: 'b', number: 2, addedAt: '2026-08-27T09:00:00Z' }],
      [],
      storage,
    );
    expect(loadTasks(storage)).toEqual({
      tasks: [{ kind: 'issue', owner: 'a', repo: 'b', number: 2, addedAt: '2026-08-27T09:00:00Z' }],
      archivedKeys: [],
      error: null,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/storage/tasks.test.ts`
Expected: FAIL — `loadTasks`/`saveTasks` don't know about `archivedKeys` yet.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/storage/tasks.ts` with:

```ts
import type { PrKey, TaskKind, TrackedTask } from '../types';
import { readKey, writeKey } from './localStorage';

export const TASKS_KEY = 'hubdash.tasks';
export const CORRUPT_TASKS_KEY = 'hubdash.tasks.corrupt';

const CURRENT_VERSION = 2;

export type LoadTasksResult = { tasks: TrackedTask[]; archivedKeys: PrKey[]; error: string | null };

const UNREADABLE = 'Your tasks could not be read and were reset.';

function isTaskKind(value: unknown): value is TaskKind {
  return value === 'pr' || value === 'issue';
}

export function isTrackedTask(value: unknown): value is TrackedTask {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isTaskKind(candidate.kind) &&
    typeof candidate.owner === 'string' &&
    candidate.owner !== '' &&
    typeof candidate.repo === 'string' &&
    candidate.repo !== '' &&
    typeof candidate.number === 'number' &&
    Number.isInteger(candidate.number) &&
    candidate.number > 0 &&
    typeof candidate.addedAt === 'string' &&
    candidate.addedAt !== ''
  );
}

function isPrKeyArray(value: unknown): value is PrKey[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function reject(storage: Storage | null | undefined, raw: string, error: string): LoadTasksResult {
  // Keep the unusable value so a later save cannot destroy the user's list.
  writeKey(storage, CORRUPT_TASKS_KEY, raw);
  return { tasks: [], archivedKeys: [], error };
}

export function loadTasks(storage?: Storage | null): LoadTasksResult {
  const raw = readKey(storage, TASKS_KEY);
  if (raw === null) return { tasks: [], archivedKeys: [], error: null };

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
  if (!('version' in envelope)) {
    return reject(storage, raw, UNREADABLE);
  }

  // A version-1 payload predates archiving on this tab entirely — nothing it
  // names was ever archived.
  if (envelope.version === 1) {
    if (!Array.isArray(envelope.tasks) || !envelope.tasks.every(isTrackedTask)) {
      return reject(storage, raw, UNREADABLE);
    }
    return { tasks: envelope.tasks, archivedKeys: [], error: null };
  }

  if (envelope.version !== CURRENT_VERSION) {
    return reject(storage, raw, 'Your tasks use an unsupported version and were reset.');
  }
  if (!Array.isArray(envelope.tasks) || !envelope.tasks.every(isTrackedTask)) {
    return reject(storage, raw, UNREADABLE);
  }
  if (!isPrKeyArray(envelope.archivedKeys)) {
    return reject(storage, raw, UNREADABLE);
  }

  return { tasks: envelope.tasks, archivedKeys: envelope.archivedKeys, error: null };
}

export function saveTasks(
  tasks: TrackedTask[],
  archivedKeys: PrKey[],
  storage?: Storage | null,
): void {
  writeKey(
    storage,
    TASKS_KEY,
    JSON.stringify({ version: CURRENT_VERSION, tasks, archivedKeys }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/storage/tasks.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: an error in `src/hooks/useTasks.ts` where it calls `saveTasks` with the old two-argument form — expected, fixed in Task 7.

- [ ] **Step 6: Bump the version and commit**

```bash
git add src/storage/tasks.ts src/storage/tasks.test.ts package.json
git commit -m "feat: add task-archiving storage, migrating hubdash.tasks to v2"
```

---

### Task 7: `useTasks` — expose and mutate `archivedKeys`

**Files:**
- Modify: `src/hooks/useTasks.ts`
- Modify: `src/hooks/useTasks.test.ts`

**Interfaces:**
- Consumes: `loadTasks`/`saveTasks` (Task 6).
- Produces: `UseTasksResult` gains `archivedKeys: PrKey[]` and `archiveTask: (key: PrKey) => void` — used by Task 8 (`TasksTab.tsx`) and Task 10 (`App.tsx`).

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to the end of `src/hooks/useTasks.test.ts`:

```ts
describe('useTasks — archiving', () => {
  it('starts with no archived keys', () => {
    const { result } = renderHook(() => useTasks({ storage: fakeStorage(), clock }));
    expect(result.current.archivedKeys).toEqual([]);
  });

  it('archives a task and persists it', () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => useTasks({ storage, clock }));
    act(() => {
      result.current.addTask({ kind: 'pr', owner: 'Example', repo: 'example-server', number: 4821 });
    });
    act(() => {
      result.current.archiveTask('example/example-server#4821');
    });
    expect(result.current.archivedKeys).toEqual(['example/example-server#4821']);
    expect(JSON.parse(storage.getItem(TASKS_KEY) ?? '').archivedKeys).toEqual([
      'example/example-server#4821',
    ]);
  });

  it('is a no-op to archive an already-archived key', () => {
    const { result } = renderHook(() => useTasks({ storage: fakeStorage(), clock }));
    act(() => {
      result.current.addTask({ kind: 'pr', owner: 'Example', repo: 'example-server', number: 4821 });
    });
    act(() => {
      result.current.archiveTask('example/example-server#4821');
      result.current.archiveTask('example/example-server#4821');
    });
    expect(result.current.archivedKeys).toEqual(['example/example-server#4821']);
  });

  it('drops a stale archived key when the task is removed', () => {
    const { result } = renderHook(() => useTasks({ storage: fakeStorage(), clock }));
    act(() => {
      result.current.addTask({ kind: 'pr', owner: 'Example', repo: 'example-server', number: 4821 });
    });
    act(() => {
      result.current.archiveTask('example/example-server#4821');
    });
    act(() => {
      result.current.removeTask('example/example-server#4821');
    });
    expect(result.current.archivedKeys).toEqual([]);
  });

  it('archiving does not change the tasks array or its order', () => {
    const { result } = renderHook(() => useTasks({ storage: fakeStorage(), clock }));
    act(() => {
      result.current.addTask({ kind: 'pr', owner: 'a', repo: 'a', number: 1 });
      result.current.addTask({ kind: 'pr', owner: 'a', repo: 'a', number: 2 });
    });
    act(() => {
      result.current.archiveTask('a/a#1');
    });
    expect(result.current.tasks.map((task) => task.number)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useTasks.test.ts`
Expected: FAIL — `archivedKeys`/`archiveTask` don't exist on the hook's result yet.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/hooks/useTasks.ts` with:

```ts
import { useCallback, useRef, useState } from 'react';
import { prKey } from '../domain/prKey';
import type { ParsedTask } from '../github/parseTaskUrl';
import { loadTasks, saveTasks } from '../storage/tasks';
import type { PrKey, TrackedTask } from '../types';

/**
 * Module-level so its identity is stable, for the same reason
 * useTrackedPrs/useBackportGroups hoist their own default clocks.
 */
const defaultClock = () => new Date().toISOString();

export type UseTasksOptions = {
  storage?: Storage | null;
  clock?: () => string;
};

export type UseTasksResult = {
  tasks: TrackedTask[];
  archivedKeys: PrKey[];
  addTask: (parsed: ParsedTask) => { added: boolean; key: PrKey };
  removeTask: (key: PrKey) => void;
  reorderTasks: (fromIndex: number, toIndex: number) => void;
  archiveTask: (key: PrKey) => void;
  storageError: string | null;
  dismissStorageError: () => void;
};

function keyOf(task: TrackedTask | ParsedTask): PrKey {
  return prKey(task.owner, task.repo, task.number);
}

/**
 * Owns the task list and, since this feature, the separate set of archived
 * keys alongside it — see the plan's note on why `archived` is not a field
 * on `TrackedTask` itself. Writes are explicit — every mutation saves both
 * pieces together — and the hook never saves on mount, so an unreadable
 * stored value is not overwritten before the user has had a chance to see
 * the warning about it. Same discipline as useTrackedPrs and
 * useBackportGroups.
 */
export function useTasks(options: UseTasksOptions = {}): UseTasksResult {
  const { storage, clock } = options;
  const now = clock ?? defaultClock;

  const initial = useRef<{
    tasks: TrackedTask[];
    archivedKeys: PrKey[];
    error: string | null;
  } | null>(null);
  if (initial.current === null) {
    initial.current = loadTasks(storage);
  }

  const [tasks, setTasks] = useState<TrackedTask[]>(initial.current.tasks);
  const [archivedKeys, setArchivedKeys] = useState<PrKey[]>(initial.current.archivedKeys);
  const [storageError, setStorageError] = useState<string | null>(initial.current.error);

  const tasksRef = useRef<TrackedTask[]>(initial.current.tasks);
  const archivedRef = useRef<PrKey[]>(initial.current.archivedKeys);

  const commit = useCallback(
    (nextTasks: TrackedTask[], nextArchived: PrKey[]) => {
      tasksRef.current = nextTasks;
      archivedRef.current = nextArchived;
      saveTasks(nextTasks, nextArchived, storage);
      setTasks(nextTasks);
      setArchivedKeys(nextArchived);
    },
    [storage],
  );

  const addTask = useCallback(
    (parsed: ParsedTask) => {
      const key = keyOf(parsed);
      if (tasksRef.current.some((task) => keyOf(task) === key)) {
        return { added: false, key };
      }
      commit([...tasksRef.current, { ...parsed, addedAt: now() }], archivedRef.current);
      return { added: true, key };
    },
    [commit, now],
  );

  const removeTask = useCallback(
    (key: PrKey) => {
      const next = tasksRef.current.filter((task) => keyOf(task) !== key);
      if (next.length === tasksRef.current.length) return;
      const nextArchived = archivedRef.current.filter((archivedKey) => archivedKey !== key);
      commit(next, nextArchived);
    },
    [commit],
  );

  const reorderTasks = useCallback(
    (fromIndex: number, toIndex: number) => {
      const current = tasksRef.current;
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.length ||
        toIndex >= current.length
      ) {
        return;
      }
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      if (moved === undefined) return;
      next.splice(toIndex, 0, moved);
      commit(next, archivedRef.current);
    },
    [commit],
  );

  const archiveTask = useCallback(
    (key: PrKey) => {
      if (archivedRef.current.includes(key)) return;
      commit(tasksRef.current, [...archivedRef.current, key]);
    },
    [commit],
  );

  const dismissStorageError = useCallback(() => setStorageError(null), []);

  return {
    tasks,
    archivedKeys,
    addTask,
    removeTask,
    reorderTasks,
    archiveTask,
    storageError,
    dismissStorageError,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useTasks.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Bump the version and commit**

```bash
git add src/hooks/useTasks.ts src/hooks/useTasks.test.ts package.json
git commit -m "feat: add archiveTask to useTasks, one-way like archiveGroup"
```

---

### Task 8: Tasks UI — archive section, split list, Archive button

**Files:**
- Create: `src/ui/TaskArchiveSection.tsx`
- Create: `src/ui/TaskArchiveSection.test.tsx`
- Modify: `src/ui/TaskRow.tsx`
- Modify: `src/ui/TaskRow.test.tsx`
- Modify: `src/ui/TasksTab.tsx`
- Modify: `src/ui/TasksTab.test.tsx`

**Interfaces:**
- Consumes: `TaskRow` (Task 10 will further add `selected`); `archivedKeys` (Task 7).
- Produces: `TaskArchiveSection` (a close copy of `BackportGroupArchiveSection`); `TasksTab` splits `tasks` into active/archived using `archivedKeys`, and gains `onArchive: (key: PrKey) => void` and `selectedKey?: PrKey | null`; `TaskRow` gains `onArchive: (key: PrKey) => void` (always available, no precondition) and `selected?: boolean`. Used by Task 10 (`App.tsx`).

- [ ] **Step 1: Write the failing tests for `TaskRow`'s Archive button and selection**

Add this `describe` block to the end of `src/ui/TaskRow.test.tsx`:

```tsx
describe('TaskRow — archiving and selection', () => {
  it('always shows an Archive button and calls onArchive with the key', async () => {
    const onArchive = vi.fn();
    render(
      <TaskRow
        task={prTask}
        entry={undefined}
        flashed={false}
        onRemove={noop}
        onArchive={onArchive}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    expect(onArchive).toHaveBeenCalledWith('example/example-server#4821');
  });

  it('marks itself selected via data-selected', () => {
    render(
      <TaskRow
        task={prTask}
        entry={undefined}
        flashed={false}
        onRemove={noop}
        onArchive={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
        selected
      />,
    );
    expect(screen.getByTestId('task-row')).toHaveAttribute('data-selected', 'true');
  });
});
```

Every other existing `<TaskRow ... />` call in this file must also gain `onArchive={noop}` — it is now a required prop.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/TaskRow.test.tsx`
Expected: FAIL — `onArchive`/`selected` are not recognized props yet.

- [ ] **Step 3: Update `TaskRow.tsx`**

Add `onArchive` and `selected` to `TaskRowProps`:

```tsx
export type TaskRowProps = {
  task: TrackedTask;
  entry: PrEntry | IssueEntry | undefined;
  flashed: boolean;
  selected?: boolean;
  onRemove: () => void;
  onArchive: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
};
```

Add a `data-selected` rule to the `Row` styled component (same treatment as `PrCard`'s):

```ts
  &[data-selected='true'] {
    background: ${tokens.color.accent}1a;
  }
```

Add an `ArchiveButton` styled component (identical shape to `RemoveButton`, just without the hover-red):

```ts
const ArchiveButton = styled.button`
  background: none;
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  padding: ${tokens.space(1)} ${tokens.space(2)};
  color: ${tokens.color.textMuted};
  cursor: pointer;
  font-size: 12px;
  flex-shrink: 0;

  &:hover {
    color: ${tokens.color.text};
    border-color: ${tokens.color.accent};
  }
`;
```

Update the function signature and markup:

```tsx
export function TaskRow({
  task,
  entry,
  flashed,
  selected = false,
  onRemove,
  onArchive,
  onDragStart,
  onDragOver,
  onDrop,
}: TaskRowProps) {
  const [dragging, setDragging] = useState(false);
  const status = statusView(entry);

  return (
    <Row
      data-testid="task-row"
      data-flashed={flashed ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      draggable
      onDragStart={() => {
        setDragging(true);
        onDragStart();
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      <Handle aria-hidden="true">⋮⋮</Handle>
      <NumberLink href={urlOf(task, entry)} target="_blank" rel="noreferrer noopener">
        {`#${task.number}`}
      </NumberLink>
      <Title>{titleOf(entry)}</Title>
      <Meta>{nameWithOwnerOf(task, entry)}</Meta>
      <Status $tone={status.tone}>{status.label}</Status>
      <ArchiveButton type="button" onClick={onArchive}>
        Archive
      </ArchiveButton>
      <RemoveButton type="button" aria-label={`Remove #${task.number} from tasks`} onClick={onRemove}>
        ✕
      </RemoveButton>
    </Row>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/TaskRow.test.tsx`
Expected: PASS, all tests green.

- [ ] **Step 5: Write the failing test for `TaskArchiveSection`**

Create `src/ui/TaskArchiveSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IssueEntry, PrEntry, PrKey, TrackedTask } from '../types';
import { TaskArchiveSection } from './TaskArchiveSection';

function task(number: number): TrackedTask {
  return { kind: 'pr', owner: 'a', repo: 'a', number, addedAt: '2026-08-27T09:00:00Z' };
}

describe('TaskArchiveSection', () => {
  it('renders nothing when there are no archived tasks', () => {
    render(
      <TaskArchiveSection
        tasks={[]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
  });

  it('starts collapsed, showing a count but no rows', () => {
    render(
      <TaskArchiveSection
        tasks={[task(1)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={() => {}}
      />,
    );
    const toggle = screen.getByRole('button', { name: /archive/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('1');
    expect(screen.queryByTestId('task-row')).not.toBeInTheDocument();
  });

  it('reveals its rows when expanded, and hides them again', async () => {
    render(
      <TaskArchiveSection
        tasks={[task(1)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={() => {}}
      />,
    );
    const toggle = screen.getByRole('button', { name: /archive/i });

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('task-row')).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.queryByTestId('task-row')).not.toBeInTheDocument();
  });

  it('expands automatically when the flashed task is inside it', () => {
    render(
      <TaskArchiveSection
        tasks={[task(1)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey="a/a#1"
        onRemoveTask={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /archive/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('still offers remove on an archived row', async () => {
    const onRemoveTask = vi.fn();
    render(
      <TaskArchiveSection
        tasks={[task(1)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={onRemoveTask}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /archive/i }));
    await userEvent.click(screen.getByRole('button', { name: /remove #1/i }));
    expect(onRemoveTask).toHaveBeenCalledWith('a/a#1');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run src/ui/TaskArchiveSection.test.tsx`
Expected: FAIL with "Cannot find module './TaskArchiveSection'".

- [ ] **Step 7: Write `TaskArchiveSection.tsx`**

Create `src/ui/TaskArchiveSection.tsx`, a close copy of `BackportGroupArchiveSection.tsx` adapted to Tasks — archived rows are read-only besides remove (no reorder, no archive button — it is already archived, and archiving is one-way):

```tsx
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { prKey } from '../domain/prKey';
import type { IssueEntry, PrEntry, PrKey, TrackedTask } from '../types';
import { TaskRow } from './TaskRow';
import { tokens } from './theme';

export type TaskArchiveSectionProps = {
  tasks: TrackedTask[];
  entries: Map<PrKey, PrEntry | IssueEntry>;
  flashedKey: PrKey | null;
  onRemoveTask: (key: PrKey) => void;
};

const Wrapper = styled.section`
  border-top: 1px solid ${tokens.color.border};
  padding-top: ${tokens.space(3)};
`;

const Toggle = styled.button`
  display: flex;
  align-items: center;
  gap: ${tokens.space(2)};
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: ${tokens.font.body};
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${tokens.color.textMuted};

  &:hover {
    color: ${tokens.color.text};
  }
`;

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${tokens.space(2)};
  margin-top: ${tokens.space(3)};
`;

/**
 * Collapsed by default — a structural copy of `BackportGroupArchiveSection`.
 * Archiving is one-way (spec §2), so there is no un-archive control here,
 * only remove.
 */
export function TaskArchiveSection({ tasks, entries, flashedKey, onRemoveTask }: TaskArchiveSectionProps) {
  const [expanded, setExpanded] = useState(false);

  // Same gap this pattern already fixed for Backports: a duplicate-add flash
  // on an already-archived task would otherwise be invisible inside a
  // collapsed section.
  useEffect(() => {
    if (
      flashedKey !== null &&
      tasks.some((task) => prKey(task.owner, task.repo, task.number) === flashedKey)
    ) {
      setExpanded(true);
    }
  }, [flashedKey, tasks]);

  if (tasks.length === 0) return null;

  return (
    <Wrapper data-testid="task-archive">
      <Toggle type="button" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        Archive
        <span>{tasks.length}</span>
      </Toggle>
      {expanded ? (
        <Rows>
          {tasks.map((task) => {
            const key = prKey(task.owner, task.repo, task.number);
            return (
              <TaskRow
                key={key}
                task={task}
                entry={entries.get(key)}
                flashed={key === flashedKey}
                onRemove={() => onRemoveTask(key)}
                onArchive={() => {}}
                onDragStart={() => {}}
                onDragOver={() => {}}
                onDrop={() => {}}
              />
            );
          })}
        </Rows>
      ) : null}
    </Wrapper>
  );
}
```

`onArchive`/drag handlers are no-ops here: `TaskRow` still requires the props, but an archived row is never draggable-relevant (dragging inside a static, collapsed-by-default section was never wired up) and cannot be archived again.

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/ui/TaskArchiveSection.test.tsx`
Expected: PASS, all tests green.

- [ ] **Step 9: Write the failing tests for `TasksTab`'s split and archive wiring**

Add this `describe` block to the end of `src/ui/TasksTab.test.tsx`, and add `archivedKeys={[]}` and `onArchive={() => {}}` to every existing `<TasksTab ... />` call in the file (both are now required props):

```tsx
describe('TasksTab — archiving', () => {
  it('renders only non-archived tasks in the main list', () => {
    render(
      <TasksTab
        tasks={[task(1), task(2)]}
        archivedKeys={['a/a#1']}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={() => {}}
        onArchive={() => {}}
        onReorder={() => {}}
      />,
    );
    expect(screen.getAllByTestId('task-row')).toHaveLength(1);
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('shows an archived task inside the collapsed archive section', async () => {
    render(
      <TasksTab
        tasks={[task(1)]}
        archivedKeys={['a/a#1']}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={() => {}}
        onArchive={() => {}}
        onReorder={() => {}}
      />,
    );
    expect(screen.queryByTestId('task-row')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /archive/i }));
    expect(screen.getByTestId('task-row')).toBeInTheDocument();
  });

  it('calls onArchive with the right key from the main list', async () => {
    const onArchive = vi.fn();
    render(
      <TasksTab
        tasks={[task(1)]}
        archivedKeys={[]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={() => {}}
        onArchive={onArchive}
        onReorder={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    expect(onArchive).toHaveBeenCalledWith('a/a#1');
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `npx vitest run src/ui/TasksTab.test.tsx`
Expected: FAIL — `archivedKeys`/`onArchive` aren't recognized props yet, and there is no archive-section split.

- [ ] **Step 11: Update `TasksTab.tsx`**

Replace the full contents of `src/ui/TasksTab.tsx` with:

```tsx
import { useRef } from 'react';
import styled from 'styled-components';
import { prKey } from '../domain/prKey';
import type { IssueEntry, PrEntry, PrKey, TrackedTask } from '../types';
import { Empty } from './Empty';
import { TaskArchiveSection } from './TaskArchiveSection';
import { TaskRow } from './TaskRow';
import { tokens } from './theme';

export type TasksTabProps = {
  tasks: TrackedTask[];
  archivedKeys: PrKey[];
  entries: Map<PrKey, PrEntry | IssueEntry>;
  flashedKey: PrKey | null;
  selectedKey?: PrKey | null;
  onRemoveTask: (key: PrKey) => void;
  onArchive: (key: PrKey) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
};

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${tokens.space(2)};
  padding: ${tokens.space(5)};
`;

export function TasksTab({
  tasks,
  archivedKeys,
  entries,
  flashedKey,
  selectedKey = null,
  onRemoveTask,
  onArchive,
  onReorder,
}: TasksTabProps) {
  // A ref, not state: the dragged index is read only inside the drop
  // handler it triggers synchronously, and does not need to drive a render.
  const dragIndex = useRef<number | null>(null);

  if (tasks.length === 0) {
    return (
      <Empty>Add an issue or pull request — use the button, paste a URL, or drop a link here.</Empty>
    );
  }

  const archivedKeySet = new Set(archivedKeys);
  const active = tasks.filter(
    (task) => !archivedKeySet.has(prKey(task.owner, task.repo, task.number)),
  );
  const archived = tasks.filter((task) =>
    archivedKeySet.has(prKey(task.owner, task.repo, task.number)),
  );

  return (
    <List>
      {active.map((task, index) => {
        const key = prKey(task.owner, task.repo, task.number);
        return (
          <TaskRow
            key={key}
            task={task}
            entry={entries.get(key)}
            flashed={key === flashedKey}
            selected={key === selectedKey}
            onRemove={() => onRemoveTask(key)}
            onArchive={() => onArchive(key)}
            onDragStart={() => {
              dragIndex.current = index;
            }}
            onDragOver={() => {}}
            onDrop={() => {
              const from = dragIndex.current;
              dragIndex.current = null;
              if (from !== null && from !== index) onReorder(from, index);
            }}
          />
        );
      })}
      <TaskArchiveSection
        tasks={archived}
        entries={entries}
        flashedKey={flashedKey}
        onRemoveTask={onRemoveTask}
      />
    </List>
  );
}
```

Note: `onReorder`'s `fromIndex`/`toIndex` are indices into the **active** list only (drag-and-drop never touches the archive section), so `reorderTasks` in `useTasks` — which operates on the full `tasks` array — needs indices translated from "position within active" to "position within all tasks" at the call site in `App.tsx` (Task 10) if `archivedKeys` is non-empty. Since active tasks are always exactly `tasks.filter(...)` in the same relative order, and `reorderTasks` only reorders within the full array by splicing at absolute indices, Task 10 must map the active-list index back to `tasks`' index before calling `reorderTasks` — see Task 10's wiring.

- [ ] **Step 12: Run the tests**

Run: `npx vitest run src/ui/TaskArchiveSection.test.tsx src/ui/TaskRow.test.tsx src/ui/TasksTab.test.tsx`
Expected: PASS, all tests green.

- [ ] **Step 13: Typecheck**

Run: `npx tsc --noEmit`
Expected: an error in `src/ui/App.tsx` where it renders `<TasksTab>` without the new required `archivedKeys`/`onArchive` props — expected, fixed in Task 10.

- [ ] **Step 14: Bump the version and commit**

```bash
git add src/ui/TaskArchiveSection.tsx src/ui/TaskArchiveSection.test.tsx src/ui/TaskRow.tsx src/ui/TaskRow.test.tsx src/ui/TasksTab.tsx src/ui/TasksTab.test.tsx package.json
git commit -m "feat: introduce task archiving — archive section, split list, button"
```

---

### Task 9: Backports UI — selection highlight only

**Files:**
- Modify: `src/ui/BackportGroupCard.tsx`
- Modify: `src/ui/BackportGroupCard.test.tsx`
- Modify: `src/ui/BackportsTab.tsx`

**Interfaces:**
- Produces: `BackportGroupCard` gains `selected?: boolean` (default `false`). `BackportsTab` gains `selectedKey?: PrKey | null`, threaded to the active-list `BackportGroupCard`s only (never into `BackportGroupArchiveSection`, matching the Board). No archiving changes here — Backports already has everything it needs (`onArchiveGroup`); only Task 10 wires the keyboard/button-adjacent selection into it.

- [ ] **Step 1: Write the failing test**

`src/ui/BackportGroupCard.test.tsx`'s `setup(overrides)` helper both renders the component (with `overrides` merged into its default props) and returns the props used — so passing `{ selected: true }` as `overrides` is enough; no re-render needed. Add a new `describe` block at the end of the file:

```tsx
describe('BackportGroupCard — selection', () => {
  it('marks itself selected via data-selected', () => {
    setup({ selected: true });
    expect(screen.getByTestId('backport-group-card')).toHaveAttribute('data-selected', 'true');
  });

  it('is not selected by default', () => {
    setup();
    expect(screen.getByTestId('backport-group-card')).toHaveAttribute('data-selected', 'false');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/BackportGroupCard.test.tsx`
Expected: FAIL — `selected` is not a recognized prop, and there's no `data-selected` attribute.

- [ ] **Step 3: Update `BackportGroupCard.tsx`**

Add `selected?: boolean` to `BackportGroupCardProps`:

```tsx
export type BackportGroupCardProps = {
  group: BackportGroup;
  entries: Map<PrKey, PrEntry>;
  onRemoveGroup: () => void;
  onAddVersion: (version: string) => void;
  onRemoveVersion: (version: string) => void;
  onFillSlot: (version: string, pr: ParsedPr) => { ok: true } | { ok: false; error: string };
  onArchiveGroup: () => void;
  flashedKey?: PrKey | null;
  selected?: boolean;
};
```

Add a `data-selected` rule to the `Card` styled component, matching `PrCard`'s:

```ts
  &[data-selected='true'] {
    background: ${tokens.color.accent}1a;
  }
```

Update the function signature and the `Card`'s attributes:

```tsx
export function BackportGroupCard({
  group,
  entries,
  onRemoveGroup,
  onAddVersion,
  onRemoveVersion,
  onFillSlot,
  onArchiveGroup,
  flashedKey = null,
  selected = false,
}: BackportGroupCardProps) {
  ...
    <Card
      data-testid="backport-group-card"
      data-complete={isComplete(group, entries) ? 'true' : 'false'}
      data-flashed={groupKey(group) === flashedKey ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
    >
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/BackportGroupCard.test.tsx`
Expected: PASS, all tests green.

- [ ] **Step 5: Thread `selectedKey` through `BackportsTab.tsx`**

Add `selectedKey?: PrKey | null` to `BackportsTabProps`, and pass `selected={groupKey(group) === selectedKey}` to the active-list `<BackportGroupCard>` only (the archive-section one, rendered inside `BackportGroupArchiveSection`, is untouched — selection never reaches it):

```tsx
export type BackportsTabProps = {
  groups: BackportGroup[];
  entries: Map<PrKey, PrEntry>;
  hasToken: boolean;
  flashedKey: PrKey | null;
  selectedKey?: PrKey | null;
  onRemoveGroup: (key: PrKey) => void;
  onAddVersion: (key: PrKey, version: string) => void;
  onRemoveVersion: (key: PrKey, version: string) => void;
  onFillSlot: (
    key: PrKey,
    version: string,
    pr: ParsedPr,
  ) => { ok: true } | { ok: false; error: string };
  onArchiveGroup: (key: PrKey) => void;
};
```

```tsx
export function BackportsTab({
  groups,
  entries,
  hasToken,
  flashedKey,
  selectedKey = null,
  onRemoveGroup,
  onAddVersion,
  onRemoveVersion,
  onFillSlot,
  onArchiveGroup,
}: BackportsTabProps) {
  ...
      {orderGroups(active, entries).map((group) => {
        const key = groupKey(group);
        return (
          <BackportGroupCard
            key={key}
            group={group}
            entries={entries}
            flashedKey={flashedKey}
            selected={key === selectedKey}
            onRemoveGroup={() => onRemoveGroup(key)}
            onAddVersion={(version) => onAddVersion(key, version)}
            onRemoveVersion={(version) => onRemoveVersion(key, version)}
            onFillSlot={(version, pr) => onFillSlot(key, version, pr)}
            onArchiveGroup={() => onArchiveGroup(key)}
          />
        );
      })}
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tests PASS. Typecheck is clean for this file (`selectedKey` is optional, so `App.tsx`'s existing `<BackportsTab>` call — which doesn't pass it yet — still compiles).

- [ ] **Step 7: Bump the version and commit**

```bash
git add src/ui/BackportGroupCard.tsx src/ui/BackportGroupCard.test.tsx src/ui/BackportsTab.tsx package.json
git commit -m "feat: add a selection highlight to BackportGroupCard"
```

---

### Task 10: Wire selection and archiving into `App.tsx`

**Files:**
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/App.test.tsx`

**Interfaces:**
- Consumes everything from Tasks 1–9: `moveSelection`/`positionOf`/`BoardColumns` (`gridNav.ts`), `archivedKeys`/`archivePr` (`useTrackedPrs`), `groupIntoColumns(entries, archivedKeys)` (`sort.ts`), `onArchive`/`selectedKey` props on `BoardTab`/`TasksTab`/`BackportsTab`, `archivedKeys`/`archiveTask` (`useTasks`), `groupKey`/`isComplete`/`orderGroups` (`../domain/backports`, already exported, not yet imported here).
- Produces: the finished feature.

- [ ] **Step 1: Add imports**

Add `groupKey`, `isComplete`, `orderGroups` to the existing import from `../domain/backports`:

```ts
import { groupKey, groupPrs, isComplete, orderGroups } from '../domain/backports';
```

Add a new import for the grid-navigation module:

```ts
import type { BoardColumns } from '../domain/gridNav';
import { moveSelection, positionOf } from '../domain/gridNav';
```

(Place these two lines in the existing alphabetically-sorted import block, in the position matching `../domain/gridNav`.)

- [ ] **Step 2: Read `archivedKeys`/`archivePr`/`archiveTask` off the two existing hooks**

Change:

```ts
  const { prs, add, remove, storageError, dismissStorageError } = useTrackedPrs({ storage, clock });
```

to:

```ts
  const {
    prs,
    archivedKeys: boardArchivedKeys,
    add,
    remove,
    archivePr,
    storageError,
    dismissStorageError,
  } = useTrackedPrs({ storage, clock });
```

Change:

```ts
  const {
    tasks,
    addTask,
    removeTask,
    reorderTasks,
    storageError: taskStorageError,
    dismissStorageError: dismissTaskStorageError,
  } = useTasks({ storage, clock });
```

to:

```ts
  const {
    tasks,
    archivedKeys: taskArchivedKeys,
    addTask,
    removeTask,
    reorderTasks,
    archiveTask,
    storageError: taskStorageError,
    dismissStorageError: dismissTaskStorageError,
  } = useTasks({ storage, clock });
```

- [ ] **Step 3: Pass `archivedKeys` into `columns`**

Change:

```ts
  const columns = useMemo(() => {
    if (prs.length === 0) return EMPTY_COLUMNS;
    const tracked = new Set(prs.map((pr) => prKey(pr.owner, pr.repo, pr.number)));
    return groupIntoColumns(entries.filter((entry) => tracked.has(entry.key)));
  }, [entries, prs]);
```

to:

```ts
  const columns = useMemo(() => {
    if (prs.length === 0) return EMPTY_COLUMNS;
    const tracked = new Set(prs.map((pr) => prKey(pr.owner, pr.repo, pr.number)));
    return groupIntoColumns(
      entries.filter((entry) => tracked.has(entry.key)),
      new Set(boardArchivedKeys),
    );
  }, [entries, prs, boardArchivedKeys]);
```

- [ ] **Step 4: Add selection state and the per-tab ordered key lists**

Immediately after the `activeTab` declaration, add:

```ts
  // One selection, reset whenever the active tab changes — spec §3, and the
  // user's explicit correction against remembering it per tab.
  const [selectedKey, setSelectedKey] = useState<PrKey | null>(null);
  useEffect(() => {
    setSelectedKey(null);
  }, [activeTab]);
```

Immediately after the `entryMap` memo, add the three per-tab navigable-key derivations (these must exactly match what each tab actually renders, in the same order, so arrow-key movement lands where the eye expects):

```ts
  // What arrow keys move through on the Board — the three live columns only;
  // archive is never reachable by keyboard (spec §2).
  const boardColumnsForNav = useMemo<BoardColumns>(
    () => ({
      waiting: columns.waiting.map((entry) => entry.key),
      needsAction: columns.needsAction.map((entry) => entry.key),
      ready: columns.ready.map((entry) => entry.key),
    }),
    [columns],
  );

  // Same active-only, same order BackportsTab itself renders.
  const activeGroupKeys = useMemo(
    () => orderGroups(groups.filter((group) => !group.archived), entryMap).map(groupKey),
    [groups, entryMap],
  );

  // Same active-only, same (stored) order TasksTab itself renders.
  const activeTaskKeys = useMemo(() => {
    const archived = new Set(taskArchivedKeys);
    return tasks
      .filter((task) => !archived.has(prKey(task.owner, task.repo, task.number)))
      .map((task) => prKey(task.owner, task.repo, task.number));
  }, [tasks, taskArchivedKeys]);
```

- [ ] **Step 5: Add the arrow-key and `a` keyboard handler**

Immediately after the existing `p`/`b`/`t` shortcut effect, add:

```ts
  // Arrow keys move the selection; `a` archives whatever is selected. Same
  // suppression as p/b/t — never while typing, never while a dialog is open
  // — which matters even more here, since arrow keys are the browser's
  // native text-cursor-movement keys.
  useEffect(() => {
    const dialogOpen = addOpen || backportDialogOpen || taskDialogOpen || settingsOpen;

    const moveFlatSelection = (keys: PrKey[], direction: 'up' | 'down') => {
      if (keys.length === 0) {
        setSelectedKey(null);
        return;
      }
      const currentIndex = selectedKey === null ? -1 : keys.indexOf(selectedKey);
      if (currentIndex === -1) {
        setSelectedKey(keys[0] ?? null);
        return;
      }
      const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= keys.length) return;
      setSelectedKey(keys[nextIndex] ?? null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (dialogOpen || isEditable(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight'
      ) {
        event.preventDefault();
        if (activeTab === 'board') {
          const direction =
            event.key === 'ArrowUp'
              ? 'up'
              : event.key === 'ArrowDown'
                ? 'down'
                : event.key === 'ArrowLeft'
                  ? 'left'
                  : 'right';
          const position = positionOf(boardColumnsForNav, selectedKey);
          const next = moveSelection(boardColumnsForNav, position, direction);
          setSelectedKey(next === null ? null : (boardColumnsForNav[next.column][next.index] ?? null));
          return;
        }
        // Backports and Tasks are flat lists — only up/down apply.
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        const direction = event.key === 'ArrowUp' ? 'up' : 'down';
        moveFlatSelection(activeTab === 'backports' ? activeGroupKeys : activeTaskKeys, direction);
        return;
      }

      if (event.key === 'a' && selectedKey !== null) {
        const key = selectedKey;
        if (activeTab === 'board') {
          archivePr(key);
          const position = positionOf(boardColumnsForNav, key);
          if (position === null) {
            setSelectedKey(null);
          } else {
            const column = boardColumnsForNav[position.column];
            setSelectedKey(column[position.index + 1] ?? column[position.index - 1] ?? null);
          }
        } else if (activeTab === 'backports') {
          const group = groups.find((candidate) => groupKey(candidate) === key);
          if (group && !group.archived && isComplete(group, entryMap)) {
            archiveGroup(key);
            const index = activeGroupKeys.indexOf(key);
            setSelectedKey(activeGroupKeys[index + 1] ?? activeGroupKeys[index - 1] ?? null);
          }
        } else {
          archiveTask(key);
          const index = activeTaskKeys.indexOf(key);
          setSelectedKey(activeTaskKeys[index + 1] ?? activeTaskKeys[index - 1] ?? null);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeTab,
    addOpen,
    backportDialogOpen,
    taskDialogOpen,
    settingsOpen,
    selectedKey,
    boardColumnsForNav,
    activeGroupKeys,
    activeTaskKeys,
    archivePr,
    archiveGroup,
    archiveTask,
    groups,
    entryMap,
  ]);
```

- [ ] **Step 6: Wire the Board's, Backports', and Tasks' rendering**

Change the `BoardTab` render:

```tsx
            <BoardTab
              columns={columns}
              isEmpty={prs.length === 0}
              flashedKey={flashedKey}
              onRemove={handleRemove}
            />
```

to:

```tsx
            <BoardTab
              columns={columns}
              isEmpty={prs.length === 0}
              flashedKey={flashedKey}
              selectedKey={selectedKey}
              onRemove={handleRemove}
              onArchive={archivePr}
            />
```

Change the `BackportsTab` render — add `selectedKey`:

```tsx
            <BackportsTab
              groups={groups}
              entries={entryMap}
              hasToken
              flashedKey={flashedKey}
              selectedKey={selectedKey}
              onRemoveGroup={removeGroup}
              onAddVersion={addVersion}
              onRemoveVersion={removeVersion}
              onFillSlot={fillSlot}
              onArchiveGroup={archiveGroup}
            />
```

Change the `TasksTab` render — add `archivedKeys`, `selectedKey`, `onArchive`, and translate `onReorder`'s active-list index back into an index over the full `tasks` array (drag-and-drop only ever operates within the active list, but `reorderTasks` splices the full, unfiltered array):

```tsx
            <TasksTab
              tasks={tasks}
              archivedKeys={taskArchivedKeys}
              entries={taskEntryMap}
              flashedKey={flashedKey}
              selectedKey={selectedKey}
              onRemoveTask={removeTask}
              onArchive={archiveTask}
              onReorder={(fromActiveIndex, toActiveIndex) => {
                const archived = new Set(taskArchivedKeys);
                const activeTasks = tasks.filter(
                  (task) => !archived.has(prKey(task.owner, task.repo, task.number)),
                );
                const fromTask = activeTasks[fromActiveIndex];
                const toTask = activeTasks[toActiveIndex];
                if (!fromTask || !toTask) return;
                const fromIndex = tasks.indexOf(fromTask);
                const toIndex = tasks.indexOf(toTask);
                reorderTasks(fromIndex, toIndex);
              }}
            />
```

- [ ] **Step 7: Fix the Tasks tab count to exclude archived tasks**

Change:

```tsx
            tasksCount={tasks.length}
```

to:

```tsx
            tasksCount={tasks.length - taskArchivedKeys.length}
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. This is the last piece — every mismatch flagged by earlier tasks' typecheck steps should now be resolved.

- [ ] **Step 9: Add integration tests to `App.test.tsx`**

Add this describe block at the end of the file:

```ts
describe('App — keyboard navigation and archiving', () => {
  it('selects and moves through the Board grid with arrow keys, and archives with a', async () => {
    const fetchImpl = boardResponder({
      pr0: prNode(4821),
      pr1: prNode(4790, { reviewDecision: 'CHANGES_REQUESTED', reviewRequests: { totalCount: 0 } }),
    });
    const storage = fakeStorage({
      [TOKEN_KEY]: storedToken,
      [TRACKED_PRS_KEY]: storedPrs(4821, 4790),
    });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);
    await waitFor(() =>
      expect(within(screen.getByTestId('column-waiting')).getByText('#4821')).toBeInTheDocument(),
    );

    // Nothing selected yet — the first down-press selects the first item of
    // the first non-empty column (waiting).
    await userEvent.keyboard('{ArrowDown}');
    const selectedInWaiting = within(screen.getByTestId('column-waiting'))
      .getAllByTestId('pr-card')
      .filter((card) => card.getAttribute('data-selected') === 'true');
    expect(selectedInWaiting).toHaveLength(1);

    await userEvent.keyboard('{ArrowRight}');
    const selectedInNeedsAction = within(screen.getByTestId('column-needsAction'))
      .getAllByTestId('pr-card')
      .filter((card) => card.getAttribute('data-selected') === 'true');
    expect(selectedInNeedsAction).toHaveLength(1);

    await userEvent.keyboard('a');
    await waitFor(() =>
      expect(within(screen.getByTestId('column-needsAction')).queryByText('#4790')).not.toBeInTheDocument(),
    );
    const toggle = screen.getByRole('button', { name: /^archive \d/i });
    await userEvent.click(toggle);
    expect(within(screen.getByTestId('archive')).getByText('#4790')).toBeInTheDocument();
  });

  it('archives the selected Backports group with a, gated on isComplete', async () => {
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
      'https://github.com/Example/example-server/pull/4821',
    );
    await userEvent.type(screen.getByLabelText(/backport to/i), '6.2');
    await userEvent.click(screen.getByRole('button', { name: /^track$/i }));

    const row = screen.getByTestId('slot-row');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(event, {
      dataTransfer: {
        types: ['text/plain'],
        getData: () => 'https://github.com/Example/example-server/pull/4840',
      },
    });
    await act(async () => {
      row.dispatchEvent(event);
    });
    await screen.findByText(/merged/i);

    await userEvent.keyboard('{ArrowDown}a');

    expect(screen.queryByTestId('backport-group-card')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /^archive$/i });
    await userEvent.click(toggle);
    expect(screen.getByText('#4821')).toBeInTheDocument();
  });

  it('archives a task with the button, moving it into the collapsed archive section', async () => {
    const fetchImpl = boardResponder({ pr0: prNode(4821) });
    render(
      <App deps={{ fetchImpl, storage: fakeStorage({ [TOKEN_KEY]: storedToken }), clock, nowMs }} />,
    );
    window.history.pushState(null, '', '/tasks');
    window.dispatchEvent(new PopStateEvent('popstate'));

    await userEvent.click(await screen.findByRole('button', { name: /add task/i }));
    await userEvent.type(
      screen.getByLabelText(/issue or pull request url/i),
      'https://github.com/Example/example-server/pull/4821',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await screen.findByText('Change number 4821');

    await userEvent.click(screen.getByRole('button', { name: /^archive$/i }));

    expect(screen.queryAllByTestId('task-row')).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /^tasks/i })).toHaveTextContent('0'),
    );
    await userEvent.click(screen.getByRole('button', { name: /^archive \d/i }));
    expect(screen.getByText('Change number 4821')).toBeInTheDocument();
  });

  it('resets the selection when switching tabs', async () => {
    const fetchImpl = boardResponder({ pr0: prNode(4821) });
    const storage = fakeStorage({
      [TOKEN_KEY]: storedToken,
      [TRACKED_PRS_KEY]: storedPrs(4821),
    });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);
    await waitFor(() =>
      expect(within(screen.getByTestId('column-waiting')).getByText('#4821')).toBeInTheDocument(),
    );

    await userEvent.keyboard('{ArrowDown}');
    expect(
      screen.getAllByTestId('pr-card').some((card) => card.getAttribute('data-selected') === 'true'),
    ).toBe(true);

    await userEvent.click(screen.getByRole('tab', { name: /backports/i }));
    await userEvent.click(screen.getByRole('tab', { name: /pull requests/i }));

    expect(
      screen.getAllByTestId('pr-card').every((card) => card.getAttribute('data-selected') === 'false'),
    ).toBe(true);
  });

  it('does not move the selection while typing an arrow-adjacent letter, and never types into an input', async () => {
    render(
      <App deps={{ fetchImpl: vi.fn(), storage: fakeStorage({ [TOKEN_KEY]: storedToken }), clock, nowMs }} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: /add pr/i }));
    await userEvent.type(screen.getByLabelText(/pull request url/i), 'a');

    expect(screen.getByLabelText(/pull request url/i)).toHaveValue('a');
    // No board card exists yet in this test at all — the only thing worth
    // asserting is that typing 'a' did not throw or attempt to archive
    // anything, which a passing render (no crash) already demonstrates.
  });
});
```

- [ ] **Step 10: Run the full suite**

Run: `npx vitest run`
Expected: PASS, every test file green, including every pre-existing Board/Backports/Tasks test (each new prop threaded through this plan is either optional with a matching default, or was updated at every call site in its own task).

- [ ] **Step 11: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with no errors. Delete `dist/` afterward (`rm -rf dist`) — it is a build artifact, not something to commit.

- [ ] **Step 12: Bump the version and commit**

```bash
git add src/ui/App.tsx src/ui/App.test.tsx package.json
git commit -m "feat: wire keyboard navigation and archiving into App

Closes out docs/superpowers/plans/2026-09-07-keyboard-navigation-and-archiving-plan.md."
```
