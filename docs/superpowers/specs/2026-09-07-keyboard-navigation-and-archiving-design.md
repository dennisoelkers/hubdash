# hubdash — Keyboard Navigation & Manual Archiving

**Date:** 2026-09-07
**Status:** Approved for implementation planning
**Extends:** `docs/superpowers/specs/2026-08-27-hubdash-design.md` (v1),
`docs/superpowers/specs/2026-08-27-backports-tab-design.md` (Backports tab),
`docs/superpowers/specs/2026-09-03-tasks-tab-design.md` (Tasks tab)

## 1. Purpose

Every item on every tab today is reachable only by mouse. This adds keyboard
navigation — arrow keys move a selection through the current tab's items —
and a single-key action, `a`, that archives whatever is selected. Archiving
already exists on the Backports tab (a per-group button); this generalizes it
to a keyboard shortcut there, and **introduces it as a new concept** on the
other two tabs, where it does not exist yet in any form.

## 2. Scope

**In scope**

- Arrow-key selection on all three tabs, reset to none whenever the active
  tab changes.
- `a` archives the selected item, where "archive" means:
  - **Backports** — exactly the existing per-group action (§6): same
    `isComplete`-gated call the Archive button already makes.
  - **Board** — a brand new, persisted, **manual** archive that sits
    alongside the existing **automatic** one (merged/closed still archives
    itself; this adds "I'm done with this" as a second path to the same
    Archive column, for anything not already there).
  - **Tasks** — a brand new archive concept, introduced by this feature.
    Nothing on this tab could be archived before.
- A clickable Archive button on the Board (`PrCard`) and Tasks (`TaskRow`),
  matching the keyboard action one-for-one, mirroring the button Backports
  already has.
- A collapsed Archive section on the Tasks tab, mirroring
  `BackportGroupArchiveSection`.
- A visible, persistent highlight on the selected item.

**Out of scope**

- **Un-archiving**, anywhere. Archiving is one-way on every tab, matching
  how it already works on Backports today (`archiveGroup` never clears the
  flag; the only way off the Archive section is `onRemoveGroup`). Board and
  Tasks follow the same rule.
- **Arrow-key reach into any Archive section.** Selection only ever moves
  through the active, non-archived items. This was weighed explicitly
  against making archive sections navigable (for a keyboard-driven undo) and
  rejected — there is no undo to reach anyway, per the point above.
- **Per-tab selection memory.** Switching tabs always resets the selection
  to none; a tab does not remember what was selected the last time it was
  active.
- **Selection into Backports' individual slots.** Selection on that tab
  moves between groups only, matching what `a` can act on.
- **A precondition on the Board's or Tasks' Archive button/shortcut.**
  Unlike Backports (which requires every version to have landed), both are
  always available — you may decide you're done with something regardless
  of its live status.

## 3. Selection model

One piece of state, owned by `App.tsx` alongside the existing `p`/`b`/`t`
shortcut: `selectedKey: PrKey | null`. Reset to `null` in an effect keyed on
`activeTab`.

Arrow keys and `a` share the exact same guard the `p`/`b`/`t` shortcut
already uses — suppressed while `isEditable(event.target)` and while any
dialog is open — which matters even more here, since arrow keys are the
browser's native text-cursor-movement keys.

If nothing is selected, the first arrow press selects the first reachable
item (top of Waiting on the Board; the first row on Backports or Tasks). No
wrap-around: moving past either end of a list, or past the grid's edge on
the Board, is a no-op. After `a` archives the selected item, selection moves
to whatever item now occupies that position (or clears to none, if the list
is now empty) — so archiving several items in a row is a rapid up/`a`,
up/`a` motion, not a repeated hunt-and-reselect.

## 4. The Board: 2D grid navigation and manual archiving

**Navigation.** Up/down moves within the current column. Left/right moves
to the adjacent column (Waiting → Needs action → Ready), landing on the same
row index — clamped to the last item if the target column is shorter. If the
adjacent column is empty, left/right keeps stepping in that direction until
it finds a non-empty one, or the grid's edge, whichever comes first (so an
empty middle column never traps the selection). This logic is small and pure
enough to live in its own tested module, `src/domain/gridNav.ts`:

```ts
export type BoardColumns = { waiting: PrKey[]; needsAction: PrKey[]; ready: PrKey[] };
export type GridPosition = { column: keyof BoardColumns; index: number };

export function moveSelection(
  columns: BoardColumns,
  current: GridPosition | null,
  direction: 'up' | 'down' | 'left' | 'right',
): GridPosition | null;
```

`App.tsx` builds a `BoardColumns` from the existing `columns` memo (each
non-archive column's entries, mapped to their keys) before calling this.

**Manual archiving.** Today a board PR's Archive-column membership is
entirely derived from its live lifecycle (`classify()` returning `archive`
for `MERGED`/`CLOSED`) — there is no persisted archived concept for a
tracked PR at all. Adding one without disturbing `TrackedPr` itself (used
everywhere, including as `BackportGroup.main`/`BackportSlot.pr`, where an
`archived` field would mean nothing) means a **separate, parallel** set of
manually-archived keys, stored alongside the tracked list:

`trackedPrs.ts`'s stored envelope moves from `{ version: 1, prs }` to
`{ version: 2, prs, archivedKeys: PrKey[] }`, using the exact migration
shape `backportGroups.ts` already established for its own `archived` field:
a v1 payload is valid and defaults to an empty set, not treated as
corrupt or unsupported. `useTrackedPrs` gains a one-way `archivePr(key)`
(a no-op if already archived, matching `archiveGroup`'s exact shape) and
exposes `archivedKeys: PrKey[]`. `remove(key)` also drops the key from
`archivedKeys` if present, so nothing dangles for a PR no longer tracked at
all.

`groupIntoColumns` (`sort.ts`) takes a new second parameter,
`archivedKeys: Set<PrKey>`, and checks it **before** anything else — ahead
of the existing error check, ahead of `classify()` — so a manually-archived
PR stays in Archive even if a later poll errors on it (the user's decision
to archive it shouldn't be overridden by a transient fetch failure):

```ts
const column = archivedKeys.has(entry.key)
  ? 'archive'
  : entry.status === 'error'
    ? 'needsAction'
    : classify(entry.pr);
```

`PrCard` gains an `onArchive` callback and an `archived: boolean` prop (true
only when rendered from `ArchiveSection`), rendering an Archive button —
styled like `BackportGroupCard`'s — only when `!archived`, exactly mirroring
that component's own conditional.

## 5. Tasks: introducing archiving from scratch

This is the same shape `BackportGroup.archived` already established,
applied to `TrackedTask`:

- `TrackedTask` gains `archived: boolean`.
- `storage/tasks.ts` moves from version 1 to 2, migrating exactly like
  `backportGroups.ts` did: a v1 payload's tasks all default to
  `archived: false`.
- `useTasks` gains a one-way `archiveTask(key)`.
- `TasksTab` splits into active and archived lists, the same way
  `BackportsTab` already does — active tasks keep rendering in the manually
  ordered list (archiving doesn't touch order); archived ones move into a
  new `TaskArchiveSection`, a close copy of `BackportGroupArchiveSection`
  (collapsed by default, same reveal-on-flash behavior for a duplicate add
  landing inside it).
- `TaskRow` gains an Archive button next to its existing remove button,
  **always available** — no precondition, unlike Backports' `isComplete`
  gate, since a task has no notion of "done," only "I've decided I'm not
  tracking this anymore."
- The Tasks tab count in `TabBar` changes from "every tracked task" to
  "active tasks only" (`tasks.filter(t => !t.archived).length`), matching
  the same archived-exclusion convention already applied to the Pull
  Requests and Backports counts.

## 6. Backports: no new mechanism

Selection moves between groups only. `a` calls the existing `onArchiveGroup`
for the selected group, under the exact same `isComplete && !archived` gate
the button already enforces — pressing `a` on an incomplete group does
nothing, same as the button not being there.

## 7. Testing

- `gridNav.ts` — up/down within a column; left/right across columns,
  including landing-row clamping and skipping an empty column; no-wrap at
  every edge; selecting the first item when nothing was selected.
- `trackedPrs.ts` / `useTrackedPrs.ts` — the v1→v2 migration, `archivePr`'s
  one-way behavior, `remove` dropping a stale archived key, persistence
  round-trip.
- `sort.ts` — a manually-archived, still-open PR lands in Archive ahead of
  `classify()`; an archived PR that later errors stays in Archive rather
  than falling to Needs action; a merged/closed PR is unaffected by the new
  parameter.
- `storage/tasks.ts` / `useTasks.ts` — same shape: v1→v2 migration,
  `archiveTask`'s one-way behavior, persistence round-trip.
- Component tests for `TaskArchiveSection`, the Archive button on `TaskRow`
  and `PrCard`, and the reveal-on-flash behavior carried over from
  `BackportGroupArchiveSection`.
- `App.test.tsx` integration — arrow-key movement on all three tabs
  (including 2D movement and column-skipping on the Board), `a` archiving on
  each tab (including the Backports `isComplete` gate still blocking it),
  suppression while typing and while a dialog is open, selection resetting
  on tab change, the Tasks tab count excluding newly-archived tasks.
