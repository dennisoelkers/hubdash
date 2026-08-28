# hubdash — Backports Tab

**Date:** 2026-08-27
**Status:** Approved for implementation planning
**Extends:** `docs/superpowers/specs/2026-08-27-hubdash-design.md` (the v1 design)

## 1. Purpose

The v1 board answers *whose move is it* for a single pull request. It cannot
answer a second question that matters just as much: **has this change actually
landed everywhere it needs to?**

A fix merged to `master` is not finished if its 6.1 backport was never opened,
or was opened and quietly closed. The board cannot show this, because a
backport's status is not a property of any one PR — it is a property of a *set*
of PRs that must all land.

This adds a second tab that tracks those sets. For each change, one main pull
request plus one slot per target version, showing only whether each has merged.

## 2. Why a tab, and not part of the board

v1 §12 deferred backports for a specific reason: a group's members disagree
about which column they belong in. Main might be Ready while the 6.2 backport
is failing and 6.1 was never opened, so either the group gets classified as an
aggregate — losing per-PR truth — or groups live outside the three-column model.

A separate tab resolves this rather than working around it. The group never has
to occupy a status column, because the tab does not have status columns. The two
tabs answer different questions with different vocabularies, and neither has to
compromise for the other.

## 3. Scope

**In scope**

- A tab bar with two tabs: Board (the v1 board, unchanged) and Backports.
- Creating a group from a main PR URL plus a comma-separated list of versions.
- Adding and removing target versions on an existing group.
- Filling a version's slot by dropping a PR link on it, or pasting a URL into it.
- Per-slot merge status: empty, open, merged, closed, or errored.
- A per-group roll-up of how many versions have landed.
- Removing a group.

**Out of scope**

- **Auto-discovery of backport PRs.** You add them yourself. Searching for PRs
  that reference the main PR's number remains deferred, for the reasons in v1
  §12: it costs a request per group per poll and can match unrelated PRs.
- **Any CI, review, or draft signal on this tab.** Merge status only. The board
  already answers those questions for PRs you track there.
- **Group reordering.** Order is derived (§8).
- **Linking the two tabs.** A PR on the board and the same PR as a group's main
  are independent entries that do not know about each other (§4).

## 4. Relationship to the v1 spec

Two v1 statements change, and one is a Global Constraint. Both are recorded here
rather than left to drift:

- **v1 §4 said the persisted keys are exactly `hubdash.token` and
  `hubdash.prs`.** There is now a third, `hubdash.backports`, plus its
  `hubdash.backports.corrupt` backup. The *principle* is unchanged and still
  binding: persisted state is identity only, never status. A group stores which
  PRs and which version labels; no merge state is ever written to disk.
- **v1 §12 listed backports as deferred.** This document supersedes that entry.
  The auto-discovery half of it remains deferred (§3).

The two tabs are **fully independent**. The same PR may appear on the board and
as a group's main PR; they are separate entries. Removing a card from the board
does not touch any group, and removing a group does not touch the board. This
was chosen over promoting a board card into a group, because the coupling —
deciding whether removing a card orphans or deletes its group — is real
complexity buying little, and because the tabs are used at different times.

## 5. Data model and persistence

```ts
type BackportSlot = {
  /** Free-text version label as the user typed it, e.g. "6.2". */
  version: string;
  /** The backport PR filling this slot, or null while the slot is empty. */
  pr: TrackedPr | null;
};

type BackportGroup = {
  main: TrackedPr;
  slots: BackportSlot[];
  /** ISO 8601, when the group was created. */
  addedAt: string;
};
```

Stored under `hubdash.backports` as `{ "version": 1, "groups": BackportGroup[] }`.

**A group is identified by its main PR's `prKey`.** There is no generated id.
This follows the codebase's existing rule that `prKey` is the one canonical
identity format, means no randomness is needed, and gives duplicate handling for
free: creating a group whose main PR already has one flashes the existing group
rather than adding a second, exactly as the board does for a duplicate card.

Loading uses the same validating pattern as `storage/trackedPrs.ts`, including
the corrupt-value guard: an unusable value is copied to
`hubdash.backports.corrupt` before the default is returned, so a malformed blob
is never silently destroyed by the next save. Validation rejects the whole value
rather than salvaging individual groups, for the same reason as v1 §4 — partial
salvage is silent partial data loss.

A group with zero slots is valid and is kept. It displays as having no versions
yet, because the user may be about to add some.

## 6. Version labels

Versions are free text, parsed from a comma-separated string:

- Split on `,`, trim each part, drop empty parts.
- Duplicates are removed, keeping the first occurrence.
- Order is preserved as typed. There is no version sorting, because version
  schemes vary and a wrong sort is worse than the order the user chose.
- A list that parses to nothing is a validation error on the dialog.

Adding a version that the group already has is a no-op. Removing a version
removes its slot **and any PR in it, without confirmation** — consistent with
v1 §7.5, where removing a card has no confirmation because re-adding costs one
paste.

## 7. Slot status

Derived by one pure function from `NormalisedPr.lifecycle`, which the existing
query already fetches. **No change to `buildQuery` or `parseResponse` is
needed.**

| Condition | Slot state |
| --- | --- |
| `slot.pr` is `null` | `empty` |
| a PR is set but no poll has returned for it yet | `pending` |
| the PR did not resolve | `errored`, carrying GitHub's message |
| `lifecycle` is `MERGED` | `merged` |
| `lifecycle` is `CLOSED` | `closed` |
| `lifecycle` is `OPEN` | `open` |

`pending` exists because a slot filled a moment ago has no status until the next
poll returns, and the honest answer for that window is "not known yet" rather
than a guess. Showing `open` would be a false claim about a PR that may already
be merged. This mirrors v1 §4, where the board is briefly empty after a reload
for the same reason.

`closed` is deliberately distinct from `open`. A backport closed without merging
means someone abandoned it, and collapsing the two would let exactly the failure
this tab exists to catch look like work in progress.

`classify`, `badgesFor` and `groupIntoColumns` are **not used on this tab**. They
answer a question this tab does not ask.

**Roll-up:** per group, the count of `merged` slots over the total number of
slots, displayed as *N of M landed*. The main PR is shown on its own row above
the slots and is not counted in either number — it is the thing being backported,
not a backport.

## 8. Ordering

Groups are ordered with **incomplete groups first**, then fully-landed ones, each
subgroup by `addedAt` descending. A group is complete when it has at least one
slot and every slot is `merged`.

This mirrors the board's instinct of putting what needs attention first. A group
whose versions have all landed is finished work; it stays until removed, because
deciding when landed work stops being interesting is the user's call, not the
app's — the same reasoning as v1 §7.5's never-auto-pruned archive.

## 9. Polling

`fetchBoard` is unchanged. `App` polls the **union** of:

- every tracked PR from the board,
- every group's main PR,
- every PR filling a slot,

deduplicated by `prKey`. Entries return keyed, and each tab looks up the keys it
cares about.

This preserves the v1 Global Constraint of **one GraphQL request per poll
regardless of how many PRs are tracked**. Twenty PRs spread across both tabs cost
the same as two. Empty slots contribute nothing to the query, since there is no
PR to ask about.

The 15000 ms interval, the visibility pause, the in-flight guard with its
coalescing follow-up, and the auth and rate-limit stops all apply unchanged and
cover both tabs at once.

## 10. User interface

### 10.1 Tab bar

```
┌────────────────────────────────────────────────────────────┐
│ hubdash    [+ Add PR]      updated 4s ago  ↻  4,812 ⚡  ⚙  │
├────────────────────────────────────────────────────────────┤
│  Board  3  │  Backports  2                                 │
├────────────────────────────────────────────────────────────┤
```

Board shows the tracked-PR count; Backports shows the group count. The active
tab is component state and is **not persisted** — the same call as the archive's
collapsed state in v1 §7.2, and it avoids a fourth key. Backports is never the
initial tab.

### 10.2 A group card

```
┌─ #4821  Fix index rotation ─────────────────── 2 of 4 landed ─┐
│ Example/example-server · octocat                      ✕ │
│ ───────────────────────────────────────────────────────────── │
│   main   #4821   ✓ merged                                     │
│   6.2    #4840   ✓ merged                                   ✕ │
│   6.1    #4841   ○ open                                     ✕ │
│   6.0    #4839   ✖ closed, not merged                       ✕ │
│   5.2    ─────   drop a pull request link here              ✕ │
│                                                 [+ version]   │
└───────────────────────────────────────────────────────────────┘
```

The card's ✕ removes the group. A row's ✕ removes that version. Each PR number
links to GitHub. A fully-landed group is dimmed the way drafts are on the board.

### 10.3 Filling a slot

Every slot is a drop target, filled or not; an empty one additionally shows the
invitation text. Dropping a link on a slot fills it. Each slot also
offers a click affordance that reveals a small URL input, so the tab is usable
without dragging.

Both paths go through `parsePrUrl` — the same single funnel as v1 §7.4 — and
show its error message verbatim on the slot.

A drop is **rejected with an inline message** when the PR is already used
elsewhere in the same group, either as the main PR or in another slot, naming
where it already sits. The same PR in two slots of one group is always a
mistake, and one check prevents a confusing display.

Dropping onto a **filled** slot replaces its PR. Correcting a wrong link is the
likely intent, and the previous value is one paste away.

### 10.4 Dragging differs per tab, deliberately

On the Board the entire window is a drop target (v1 §7.4). On the Backports tab
that is ambiguous, because a link must land in a *specific* slot. So while
Backports is active, the window-level drag-and-paste handler is disabled and
slots are the only drop targets.

This is the one interaction that is not uniform across the app, and it is
uniform in the way that matters: a dropped link always goes somewhere
unambiguous.

### 10.5 Creating a group

One dialog with two fields — the main PR URL and the comma-separated versions —
validating each independently and showing `parsePrUrl`'s message for a bad URL.
A group whose main PR is already tracked flashes the existing card instead of
creating a second.

### 10.6 Empty states

With no groups, the tab shows a prompt to add one. With no token, the tab shows
the same token prompt the board does, because nothing can be resolved without
one.

## 11. Error handling

Unchanged from v1 §9 and shared across both tabs, because both are fed by the
same poll:

- Transport failures keep the last good data on screen and turn the freshness
  indicator amber.
- An auth failure stops polling and shows the persistent banner.
- A rate limit backs off until the reset time.
- **A PR that cannot be resolved errors only its own row.** A group's main PR
  failing does not blank its slots, and one group's failure does not affect
  another — the same per-PR isolation v1 §9 requires of the board.
- A malformed `hubdash.backports` value is reported in a dismissable banner and
  the corrupt blob is preserved.

## 12. Structure

```
src/
  domain/
    backports.ts          # slot state, roll-up, completeness, ordering
    parseVersions.ts      # comma-separated string -> string[]
  storage/
    backportGroups.ts     # validating load/save for hubdash.backports
  hooks/
    useBackportGroups.ts  # group state + persistence, mirrors useTrackedPrs
  ui/
    TabBar.tsx
    BoardTab.tsx          # extracted from App (see below)
    BackportsTab.tsx
    BackportGroupCard.tsx
    SlotRow.tsx
    AddBackportGroupDialog.tsx
```

Modified: `src/types.ts` (the three new types), `src/ui/App.tsx`.

**A targeted improvement, included because this work makes it necessary.**
`App.tsx` is already the largest file in the project, and adding a second tab's
state and rendering to it would make it the place where everything lives. The
board's rendering moves to `BoardTab`, leaving `App` as what it claims to be: a
composition root owning the token, the poll, the banners, and which tab is
showing. `BoardTab` and `BackportsTab` become siblings with the same shape.

This is scoped to what the feature touches. No other restructuring is proposed.

## 13. Testing

Development is test-first, as in v1 §11.

**`parseVersions`** — a normal list; extra whitespace; empty parts; duplicates;
a string that parses to nothing; order preservation.

**`backports.ts`** — every row of the §7 table including the errored case; the
roll-up excluding the main PR; a zero-slot group; completeness requiring at
least one slot; and the §8 ordering with incomplete groups ahead of complete
ones and recency within each.

**`backportGroups.ts` storage** — round-trip; absent, non-JSON, wrong-shape,
wrong-version, and bad-slot values each yielding the default without throwing;
the corrupt backup written before the default is returned.

**`useBackportGroups`** — add, remove, add a version, remove a version, fill a
slot, replace a filled slot, reject a duplicate PR within a group, and duplicate
group detection returning a verdict synchronously so the caller can flash.

**Components** — a group card renders one row per slot with the right state; an
empty slot accepts a drop; a filled slot's replace path; the group and version
remove controls; the dialog's two independent validations; the tab bar switches
and shows counts.

**Integration in `App`** — the poll targets are the deduplicated union of both
tabs; switching tabs does not trigger a poll; a group's row shows merged after a
poll; and the window-level drop handler is inactive while Backports is showing.

## 14. Deferred

- **Auto-discovery** of backport PRs by searching for references to the main
  PR's number (v1 §12's reasoning still applies).
- **Version sorting.** Order is as typed, because version schemes vary.
- **Cross-tab awareness**, such as offering to create a group when a tracked
  board PR merges.
- **Per-slot CI or review status.** Deliberately not this tab's job.
