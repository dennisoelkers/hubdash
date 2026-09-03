# hubdash — Tasks Tab

**Date:** 2026-09-03
**Status:** Approved for implementation planning
**Extends:** `docs/superpowers/specs/2026-08-27-hubdash-design.md` (v1),
`docs/superpowers/specs/2026-08-27-backports-tab-design.md` (Backports tab)

## 1. Purpose

The Pull Requests tab answers *whose move is it* for a tracked PR. The Backports
tab answers *has this landed everywhere it needs to*. Neither answers a third
question: **of everything I could work on right now, what's next?**

That list isn't derived from PR status — it's a personal priority call, and it
isn't limited to PRs either: a GitHub issue can be just as much "the next thing"
as a pull request. This adds a third tab, Tasks, holding a single manually
ordered list of issues and pull requests, each showing its live GitHub status.

## 2. Why a third tab, not a feature on an existing one

The existing two tabs each impose their own layout on what they track: the
board sorts into three status columns, Backports groups by main-PR-plus-slots.
Neither layout has room for "an arbitrary ranked list the user set by hand" —
forcing status-column placement onto a manually-ordered list would fight the
user's ordering, and forcing a backport group's shape onto a bare item would
invent a slot for a version that isn't there.

A third tab avoids retrofitting either format. Same pattern as the Backports
tab's own justification (§2 of that spec): different question, different tab,
different vocabulary, no compromise on either side.

## 3. Scope

**In scope**

- A third tab, Tasks, reachable at `/tasks`.
- Tracking GitHub issues and pull requests by full URL only (no
  `owner/repo#N` shorthand — see §7).
- A single flat list in user-controlled order, reordered by dragging a row.
- Live GitHub status per item, shown as a badge: `waiting`, `needs action`,
  `ready`, `merged` (PRs only), or `closed`.
- Manual removal of a task.
- The usual add affordances: a toolbar button, pasting a link, and dropping a
  link on the tab.

**Out of scope**

- **Auto-removal of completed tasks.** Merged PRs and closed issues stay on
  the list, badge updated, until removed by hand — same "never silently drop
  something the user tracked" rule the other two tabs already follow.
- **Status-driven ordering or grouping.** Status is a badge, never a sort key
  or a column. §6 of the brainstorm settled this explicitly: the whole point
  of this tab is a priority order status can't compute.
- **Per-row drop-to-fill**, unlike `SlotRow` on the Backports tab. A task has
  nothing else to ask for once you have its URL, so there's no dialog step to
  pre-fill. Dropping a link only ever appends a new task.
- **Shorthand `owner/repo#N` input.** See §7 — genuinely ambiguous between
  issue and PR without an extra request, and every other way of getting a
  link into this app already gives you a full URL.
- **Linking tasks to the same PR tracked on another tab.** Independent
  entries, no shared identity beyond what polling already dedupes for free
  (§5).

## 4. Relationship to prior specs

This is the first feature to change an interface the other two tabs depend
on, so the change is recorded here as binding on all three:

- **`buildQuery`, `parseResponse`, and `fetchBoard` now take `TrackedTask[]`
  instead of `TrackedPr[]`.** Board and Backports adapt at the single point
  they already assemble the shared poll list (`App.tsx`'s `pollTargets`), by
  tagging their existing `TrackedPr`s with `kind: 'pr'`. `TrackedPr` itself —
  and every other place it's used (storage, `useTrackedPrs`,
  `useBackportGroups`, `groupPrs`) — is unchanged.
- **`PollResult` gains a second array, `issueEntries: IssueEntry[]`,
  alongside the existing `entries: PrEntry[]`.** `PrEntry`'s own shape does
  not change. Board and Backports keep consuming `entries` exactly as they
  do today; only `App.tsx` and the new Tasks code read `issueEntries`.
- The poll stays a single GraphQL request regardless of how many tabs have
  something tracked — the same guarantee v1 §5.1 and the Backports spec both
  rely on. Tasks is a third consumer of that one request, not a second
  request.

Everything else in v1 and the Backports spec is unchanged.

## 5. Data model and persistence

```ts
export type TaskKind = 'pr' | 'issue';

/**
 * A GitHub issue or PR tracked as a task. Also reused, unmodified, as the
 * generalized shape buildQuery/parseResponse/fetchBoard now accept in place
 * of TrackedPr — see §4.
 */
export type TrackedTask = {
  kind: TaskKind;
  owner: string;
  repo: string;
  number: number;
  /** ISO 8601, when the task was added. */
  addedAt: string;
};
```

Stored under `hubdash.tasks` as `{ "version": 1, "tasks": TrackedTask[] }`.
**Array order is the priority order** — there is no separate rank field, and
reordering is exactly "move this entry to a new index in the array."

Loading follows `trackedPrs.ts`'s existing validating pattern, including the
corrupt-value guard: an unusable stored value is copied to
`hubdash.tasks.corrupt` before the default (empty list) is returned, same as
v1 §4 and the Backports spec §5 both already establish for their own stores.

A task's identity is `prKey(owner, repo, number)` — the same function used
everywhere else in this codebase, unmodified. This is safe across kinds
without a collision guard: GitHub issues and pull requests in one repo share
a single number sequence, so `owner/repo#N` can never resolve to both an
issue and a PR at once. Duplicate-add detection (flash the existing row
instead of adding a second one) reuses the exact mechanism Board and
Backports already have.

## 6. Query, parsing, and status

**Query.** `buildQuery` aliases each `TrackedTask` to either
`pullRequest(number) { ...prFields }` (existing fragment, unchanged) or
`issue(number) { ...issueFields }`:

```graphql
fragment issueFields on Issue {
  number
  title
  url
  state
  updatedAt
  author { login }
  repository { nameWithOwner }
}
```

`ISSUE_FIELDS` is appended to the query only when at least one issue-kind
target is present, mirroring how `PR_FIELDS` is already appended
conditionally today.

**Parsing.** For a pr-kind target, `parseResponse` behaves exactly as it does
today — it strips the `kind` tag back off before building `PrEntry.tracked:
TrackedPr`, so `PrEntry`'s shape is byte-for-byte what it has always been.
For an issue-kind target, it builds:

```ts
export type NormalisedIssue = {
  key: PrKey;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  nameWithOwner: string;
  updatedAt: string;
  lifecycle: 'OPEN' | 'CLOSED';
};

export type IssueEntry =
  | { status: 'ok'; key: PrKey; tracked: TrackedTask; issue: NormalisedIssue }
  | { status: 'error'; key: PrKey; tracked: TrackedTask; message: string };
```

pushed to the new `issueEntries` array. An inaccessible or deleted issue
produces an errored `IssueEntry` via the same per-alias GraphQL error path
`parseResponse` already uses for a missing PR — no new error-handling
mechanism, just a second shape it can produce.

**Status.** Each task resolves to one of five display states — `waiting`,
`needsAction`, `ready`, `merged`, `closed`:

- A pr-kind task with `lifecycle: 'OPEN'` uses `classify()` completely
  unchanged (`waiting | needsAction | ready` — `classify` never returns
  `archive` for an open PR). `MERGED` and `CLOSED` are reported as their own
  distinct terminal labels rather than classify's single `archive` bucket,
  matching the Backports tab's existing reasoning: knowing merged from
  closed-without-merging is worth more than one undifferentiated "done."
- An issue-kind task gets a small, separate classifier —
  `src/domain/classifyIssue.ts` — since `NormalisedIssue` carries none of the
  CI/review/mergeable/draft signals `needsAction`/`ready` depend on:
  `OPEN → waiting`, `CLOSED → closed`. This is deliberately not folded into
  `classify.ts`, which is written specifically around PR signals.

Status is display-only. It never affects a task's position in the list.

## 7. Why full URLs only

Issues and pull requests share one number sequence per repository, so a bare
`owner/repo#42` cannot say which type it names without an extra request to
GitHub. A full URL doesn't have this problem — `/pull/42` and `/issues/42`
already say so. Rather than spend a request per shorthand add resolving the
ambiguity, Tasks requires the full URL. `parsePrUrl` (used by the Pull
Requests and Backports tabs, where every target is necessarily a PR) is
unchanged; a new `parseTaskUrl` handles Tasks' input, accepting `/pull/N` or
`/issues/N` and rejecting the shorthand with a message naming the reason
("Tasks needs the full GitHub link — owner/repo#N could be either an issue
or a pull request").

## 8. UI

**Adding a task.** `AddTaskDialog` — same single-URL-field shape as
`AddPrDialog` — parses with `parseTaskUrl`. The toolbar's add button, pasting
a link, and dropping a link on the tab all route through it. A link dropped
on the Tasks tab background adds directly (like the Pull Requests tab),
since there's no second field to collect first (unlike Backports, which
needs a version list). `DropOverlay` extends to show while dragging over the
Tasks tab too.

**The list.** One row per task, in stored order, each showing: title, owner/repo,
number, a link to GitHub, its status badge, and a remove button. A task
whose poll hasn't resolved yet shows a pending state; an errored one shows
the transport error message — both following the same pattern
`SlotRow`/`BackportGroupCard` already use for their own entries.

**Reordering.** Native HTML5 drag-and-drop (`draggable`, `dragstart`,
`dragover`, `drop`) on each row — no new dependency. Rows handle reordering
only; adding-by-drop is handled once at the tab-background level (§8, "Adding
a task"), so the two drag gestures never compete for the same drop target.
A drop reorders the in-memory list and writes straight through to
`hubdash.tasks`, same as every other mutation in this app.

**Tab bar and routing.** `TabId` gains `'tasks'`. The third tab shows
`Tasks  N`, where `N` is `tasks.length` — there's no archived/hidden subset
to exclude here, unlike the Pull Requests/Backports counts. `/tasks` joins
`/pulls` and `/backports` as a recognized route; anything else still
redirects to `/pulls` per the existing rule.

**Removal.** A ✕ button per row. Manual only — a merged PR or closed issue
stays on the list, badge updated, until removed by hand.

## 9. Testing

No new error-handling mechanism is introduced — an inaccessible issue is
handled by the same per-alias GraphQL error path `parseResponse` already
uses for a missing PR, and transport failures (auth/rate-limit/network) are
unaffected since they're handled once in `post()`, before any per-item
parsing happens.

- `buildQuery.test.ts` — issue-kind aliasing, conditional fragment, mixed
  pr+issue queries.
- `parseResponse.test.ts` — issue-kind targets land in `issueEntries`; an
  inaccessible issue produces an errored `IssueEntry`; mixed responses split
  correctly between the two arrays.
- `client.test.ts` — `fetchBoard` accepting `TrackedTask[]`; existing fixtures
  migrate to add `kind: 'pr'`.
- `classifyIssue.test.ts` — `OPEN → waiting`, `CLOSED → closed`.
- `parseTaskUrl.test.ts` — full PR URL, full issue URL, shorthand rejected,
  non-GitHub/malformed input rejected.
- Storage/hook tests for the new `useTasks` hook — add/remove/reorder, the
  corrupt-value backup, persistence round-trip — mirroring
  `useTrackedPrs`/`useBackportGroups`.
- Component tests for `AddTaskDialog` and the task row/list — pending/ok/error
  rendering for both kinds, status badges, simulated drag-reorder, manual
  remove, empty state.
- `App.test.tsx` integration — `/tasks` routing, tab count, add via
  dialog/paste/drop, live status after a poll, reorder persisting across
  polls, duplicate-add flashing instead of adding twice.
