# hubdash — Backports Tab, Round 2: Routing, Drop-to-Create, Completion, Archive

**Date:** 2026-08-27
**Status:** Approved for implementation planning
**Extends:** `docs/superpowers/specs/2026-08-27-backports-tab-design.md` (round 1) and, transitively, `docs/superpowers/specs/2026-08-27-hubdash-design.md` (the board)

## 1. Purpose

Round 1 shipped the Backports tab: groups, slots, merge status, an add dialog. Five gaps remained from using it:

1. The tab you're on isn't in the URL, so it can't be bookmarked or shared.
2. Dropping a PR link only works inside the Backports tab if it lands exactly on an empty or filled slot — dropping "somewhere on the page" does nothing, unlike the board.
3. A group whose main PR you just dropped has no faster path onto the tab than the manual dialog.
4. A fully-landed group is dimmed — the same "needs less attention" treatment the board gives a draft — which reads as deprioritized when the truth is the opposite: everything shipped.
5. A finished group has no way to leave the active list. It sits there forever, or you delete it and lose the record of which versions it went to.

This round closes all five.

## 2. Scope

**In scope**

- URL routes `/pulls` and `/backports`, kept in sync with the active tab in both directions (click → URL, and URL/back-forward → tab).
- Dropping a PR link on the Backports tab's own background (not on a slot) opens the create-group dialog pre-filled with that PR as the main one.
- A completed group (every slot filled and merged) gets a distinct green treatment, on top of the existing dim.
- An "Archive" action on a completed group, moving it into a collapsed Archive section — the same pattern the board already uses for merged/closed PRs.

**Out of scope**

- Auto-discovery, version sorting, cross-tab awareness, CI/review signal on Backports — all still deferred per round 1 §14, unchanged by this round.
- Un-archiving a group. The board has no un-remove either; the nearest equivalent action (removing the group entirely) is one click away.
- Any change to what happens to a duplicate group's typed versions on re-add (round 1 fixed the *silence* — a flash now happens — but merging the versions in was explicitly left alone, and stays left alone here).
- Deep-linking to a *specific group* (e.g. `/backports/4821`). Two tab-level routes only.

## 3. Routing

`wouter` is added as a dependency — the app's first runtime dependency beyond React. The routing need is two static paths with no parameters and no nesting; a full router is more than this needs, but zero-dependency hand-rolled History API code was weighed and rejected in favor of not maintaining routing edge cases (base paths, encoding) by hand for a feature this small.

| Path | Renders |
| --- | --- |
| `/pulls` | Board tab |
| `/backports` | Backports tab |
| `/` | Redirects to `/pulls` |
| anything else | Redirects to `/pulls` |

`App` no longer owns `activeTab` as local `useState`. The active tab is derived from the current route, and `TabBar`'s `onChange` navigates instead of setting state — there is exactly one source of truth for which tab is showing, and it is the URL. Switching tabs, using the browser's back/forward buttons, and loading a bookmarked `/backports` link are all the same code path.

## 4. Drop-to-create on the Backports tab

Round 1's `App.tsx` disabled the window-level drop/paste handler entirely while `activeTab !== 'board'` (spec round 1 §10.4), because a dropped link needs to land somewhere unambiguous and the board's "anywhere on the window" behavior doesn't make sense when the page has per-slot targets. That reasoning still holds for *slots* — it just needs a second destination for a drop that isn't on one.

The window-level handler's behaviour while the Backports tab is active:

- **A drop lands on an existing slot** (empty or filled): unchanged from round 1. `SlotRow`'s own drop target handles it directly and calls `event.stopPropagation()` — round 1 flagged this call as a defense-in-depth gap and left it, on the reasoning that the window handler was fully disabled and had nothing to stop. It is no longer optional: without it, a slot-drop would also bubble up to the window handler below and open the create-group dialog on top of the slot fill that just happened.
- **A drop lands anywhere else on the Backports tab**: the dropped text is parsed with the same `parsePrUrl` the board uses. On success, `AddBackportGroupDialog` opens with its main-PR field pre-filled and focus moved to the versions field — the user types versions (or none) and submits, or cancels and nothing is created. On parse failure, the existing inline error banner shows `parsePrUrl`'s message, exactly as a bad drop on the board does today.

This one flow answers both round-1-follow-up requests at once: a dropped PR becomes a group's main PR through the same confirmation step every other group goes through, and once created it shows status "like any other" because status has never been anything but a poll result attached to a tracked PR — there is nothing group-drop-specific left to build for that part.

`AddBackportGroupDialog` gains an optional `initialUrl` prop, set only by the drop handler; the manual "+ Track backports" button continues to open it empty.

## 5. Completion styling

`isComplete(group, entries)` (round 1, `src/domain/backports.ts`) already computes the right boolean; round 1 spent it entirely on dimming (`opacity: 0.6`). This round adds a green treatment on top of, not instead of, that dimming — a completed card is both quieter *and* marked done, rather than one replacing the other.

Concretely: a `2px solid` left border and a low-opacity green background wash, using the same `tokens.color.good` (`#3fb950`) the board's own "merged" badge already uses — no new color introduced. Checked against the app's actual palette before committing to this: `good` at reduced opacity over the app's near-black background (`#0d1117`) stays clearly green rather than washing out, because the opacity reduction is uniform bri­ghtness scaling, not a blend toward gray. This is a CSS-only change; `isComplete`'s existing call site and the `data-complete` attribute it already sets are reused as-is.

## 6. Archive

### 6.1 Data model

`BackportGroup` gains one field:

```ts
export type BackportGroup = {
  main: TrackedPr;
  slots: BackportSlot[];
  addedAt: string;
  /** Set only by the user's own Archive action; never implied by isComplete. */
  archived: boolean;
};
```

`archived` is identity, not status, in the same sense round 1's persistence principle already draws: it's a fact about what the user *did*, not a derived fact about GitHub's current state (that's what `isComplete`/`prStateFor` are for, and they stay purely derived, still never persisted).

The stored envelope's version increments from `1` to `2`. `loadBackportGroups`'s validator accepts a version-`1` payload and migrates it in memory (every existing group gets `archived: false`) before returning — round 1's "no default to write" phrasing doesn't apply here, since `false` *is* the correct default for every pre-existing group. A version below `1` or above `2`, or any other shape failure, still routes through the existing corrupt-backup-then-reset path unchanged.

### 6.2 Behavior

- `useBackportGroups` gains `archiveGroup(key: PrKey): void`, following the exact pattern `removeGroup` already uses: read `groupsRef.current`, produce a new array with that group's `archived` flipped to `true`, commit (write ref, persist, `setGroups`). No new pattern introduced.
- `BackportGroupCard` renders an "Archive" button only when `isComplete(group, entries)` is true. Clicking it calls `archiveGroup`. The button does not appear on an incomplete group, and there is no confirmation step — consistent with every other destructive-ish action in this app (remove a card, remove a version), where undo cost is "recreate it," not "confirm first."
- `BackportsTab` splits `groups` into active (`!archived`) and archived (`archived`) before calling `orderGroups` on the active set only. Archived groups render inside a new `BackportGroupArchiveSection`, collapsed by default, showing a count — a direct structural copy of the board's existing `ArchiveSection`, differing only in rendering `BackportGroupCard` instead of `PrCard`.
- Archived groups are still polled. Round 1 already established (§9) that archived-equivalent entries (the board's merged/closed PRs) stay in the poll set, for the same reason: no per-entry exclusion logic, and the query cost doesn't grow per PR anyway. An archived group whose slot somehow regresses (a merge reverted, say) will still show that if you expand the section.

## 7. Testing

- `parsePrUrl` reuse needs no new tests — unchanged function, new caller.
- **Routing:** `/pulls`, `/backports`, `/`, and an unknown path each render the right tab; clicking a tab updates the URL; a `popstate` (simulated back navigation) updates the rendered tab without a click.
- **Drop-to-create:** a drop on the Backports background with a valid URL opens the dialog pre-filled; submitting creates the group; cancelling creates nothing; a drop on an existing slot does *not* also open the dialog (the `stopPropagation` regression this round makes load-bearing); a drop with an unparseable payload shows the inline error and opens no dialog.
- **Completion styling:** `data-complete='true'` still gated on `isComplete`, unchanged assertion from round 1; a new test confirms the green-marker class/attribute appears alongside it, not instead of the existing dim.
- **Archive:** `archiveGroup` moves a group from active to archived and persists it; the Archive button is absent on an incomplete group and present on a complete one; a version-1 stored payload loads with every group's `archived` defaulted to `false`; the archived section starts collapsed and expands on click, mirroring the board's existing `ArchiveSection` test shape exactly.

## 8. Deferred

- Un-archiving.
- Deep links to one specific group.
- Auto-merging versions into an existing group on a duplicate add (still round 1's decision, still unchanged).
