# hubdash — Design

**Date:** 2026-08-27
**Status:** Approved for implementation planning

## 1. Purpose

A single-screen dashboard showing the state of the GitHub pull requests I
currently have in flight. It answers one question at a glance: **whose move is
it?** For each tracked PR that means telling me whether I am blocked on someone
else, whether something needs my attention, or whether it is ready to merge.

I add PRs to the board myself. The board never guesses which PRs are mine.

## 2. Scope

**In scope for v1**

- Add a PR by URL: via a button, by dragging a link onto the window, or by paste.
- Cards grouped into three columns — Waiting, Needs action, Ready — plus a
  collapsed Archive for merged and closed PRs.
- Automatic classification of each PR from its review state, CI state, merge
  state and lifecycle.
- Polling every 15 seconds, plus a manual Refresh button.
- Persistence of the tracked list and the API token in `localStorage`.
- Removing a PR from the board.

**Explicitly out of scope for v1**

- Backport tracking of any kind. Considered and deliberately deferred; the
  grouped-slots design needs its own round of work.
- Manual card positioning or a free-form canvas. Card position is always derived
  from status.
- Notifications, sound, or badge counts outside the page.
- Multiple boards or profiles.
- Auto-importing "all my open PRs" or any other search-based discovery.
- Any write operation against GitHub. hubdash is read-only; merging, reviewing
  and re-running CI all happen on GitHub itself.

## 3. Architecture

A **pure static single-page application.** The browser calls
`api.github.com` directly, which is possible because GitHub sends permissive
CORS headers on its API. There is no server component, no build-time secret and
no deployment story beyond serving a static directory.

**Stack:** Vite, React 19, TypeScript in strict mode, styled-components for
styling, Vitest with Testing Library for tests.

The consequence of having no backend is that the personal access token lives in
`localStorage` and is readable by anything that can execute JavaScript on the
app's origin. This is accepted: the app is a local tool serving one person, and
the token only needs read scopes. It is recorded here so the trade-off is not
rediscovered later as a surprise. The mitigations are that the token is stored
under its own key, is never logged, is rendered masked, and can be cleared from
the settings dialog.

## 4. Data model and persistence

Two independent `localStorage` keys, so that a corrupt value in one cannot take
out the other:

| Key | Contents |
| --- | --- |
| `hubdash.token` | `{ "version": 1, "token": string }` |
| `hubdash.prs`   | `{ "version": 1, "prs": TrackedPr[] }` |

A third key, `hubdash.backports`, was added later by
`2026-08-27-backports-tab-design.md`. The identity-only principle below is
unchanged and still binds it.

```ts
type TrackedPr = {
  owner: string;    // "Graylog2"
  repo: string;     // "graylog2-server"
  number: number;   // 4821
  addedAt: string;  // ISO 8601
};
```

**Persisted state is identity only. Status is never persisted.** Everything
shown on a card — review decision, CI result, mergeability, title, author — is
derived from the most recent poll and held in memory only. This makes a stale
board impossible after a reload, and means a change made on GitHub can never
leave a card asserting something untrue. The cost is an empty board for the
duration of the first poll after load, which is acceptable.

Both keys are read through a validating loader. A missing, unparseable, or
wrong-shaped value is treated as absent and replaced with the default, and the
event is reported once in the UI rather than thrown. A bad blob in
`localStorage` must never white-screen the app.

The `version` field exists so that a future shape change can migrate rather than
discard. v1 ships with no migrations.

## 5. GitHub integration

### 5.1 One batched GraphQL query

All tracked PRs are fetched in a **single GraphQL request** per poll, with one
aliased `repository` field per PR sharing a common fragment:

```graphql
query Board {
  rateLimit { limit cost remaining resetAt }
  pr0: repository(owner: "Graylog2", name: "graylog2-server") {
    pullRequest(number: 4821) { ...prFields }
  }
  pr1: repository(owner: "Graylog2", name: "graylog-plugin-enterprise") {
    pullRequest(number: 912) { ...prFields }
  }
}

fragment prFields on PullRequest {
  number
  title
  url
  state                       # OPEN | CLOSED | MERGED
  isDraft
  updatedAt
  author { login }
  baseRefName
  repository { nameWithOwner }
  reviewDecision              # APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null
  mergeable                   # MERGEABLE | CONFLICTING | UNKNOWN
  reviewRequests(first: 20) { totalCount }
  latestReviews(first: 20) { nodes { state author { login } } }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          state               # SUCCESS | FAILURE | ERROR | PENDING | EXPECTED
          contexts(first: 100) {
            totalCount
            nodes {
              __typename
              ... on CheckRun { name conclusion status detailsUrl }
              ... on StatusContext { context state targetUrl }
            }
          }
        }
      }
    }
  }
}
```

This costs one or two rate-limit points per poll regardless of how many PRs are
tracked — twenty PRs cost the same as two. At a 15-second interval that is
roughly 350 of the 5,000 hourly points, about 7% of the budget. The same
information over REST would need three or more requests per PR and would exceed
the hourly limit at this cadence.

### 5.2 Fields that need care

- **`statusCheckRollup` is null when a PR has no checks at all.** This must be
  modelled as a distinct `none` CI state, not folded into failure or pending.
  See §6 — a PR in a repo without CI must still be able to reach Ready.
- **`mergeable` returns `UNKNOWN` while GitHub computes it asynchronously.**
  `UNKNOWN` must be treated as "not known to conflict" and must never move a
  card to Needs action. Only `CONFLICTING` does.
- **`reviewDecision` is null** when the repository does not require review. It
  is not a synonym for `REVIEW_REQUIRED`.
- `contexts(first: 100)` is a deliberate cap. A PR with more than 100 checks
  will have an accurate rollup `state` but a possibly incomplete failing-check
  list; the badge therefore reads from `totalCount` and the rollup state, not
  from the length of the returned array.

### 5.3 Authentication

A classic or fine-grained personal access token, sent as
`Authorization: Bearer <token>`. Required scope is `repo` for private
repositories; public-only use needs no scope. The settings dialog validates a
newly entered token immediately with a `query { viewer { login } }` call and
reports the resolved login on success, so a typo is caught at entry rather than
at the next poll.

## 6. Status classification

Classification is a **pure function** `classify(pr): Column` over a normalised
view of the API response. Two normalised values it depends on:

```ts
type CiState = 'success' | 'failure' | 'pending' | 'none';
// 'none'    <- statusCheckRollup is null
// 'failure' <- rollup state FAILURE or ERROR
// 'pending' <- rollup state PENDING or EXPECTED
// 'success' <- rollup state SUCCESS
```

Rules, evaluated in order, first match wins:

| # | Condition | Column |
| - | --------- | ------ |
| 1 | `state` is `MERGED` or `CLOSED` | **Archive** |
| 2 | `ci` is `failure` | **Needs action** |
| 3 | `mergeable` is `CONFLICTING` | **Needs action** |
| 4 | `reviewDecision` is `CHANGES_REQUESTED` | **Needs action** |
| 5 | `isDraft` | **Needs action** |
| 6 | `reviewDecision` is `APPROVED` and `ci` is `success` or `none` | **Ready** |
| 7 | anything else | **Waiting** |

The three columns each answer "whose move is it":

- **Needs action** — mine. Something is broken, someone asked for changes, or a
  draft is waiting on me to finish it.
- **Waiting** — someone else's, or a machine's. A reviewer has not looked yet,
  or CI is still running.
- **Ready** — approved and green; nothing stands between it and a merge.

Notes on specific rules:

- Rule 3 puts merge conflicts in Needs action alongside build failures. A red
  merge box demands the same action from me as a red build, and this avoids
  inventing a fourth column.
- Rule 5 places drafts in Needs action because nobody else can act on a draft.
  They are sorted to the bottom of the column and rendered dimmed (§7.3) so that
  a long-lived draft cannot bury a build that broke minutes ago.
- Rule 6 accepts `ci === 'none'`. Without this, an approved PR in a repository
  with no CI configured would sit in Waiting forever.
- Rules 2–5 are checked before rule 6, so a PR that is approved *and* failing
  correctly reads as Needs action.

### 6.1 Badges

The column states the verdict; badges state the evidence, so that a card never
hides a reason. Badges are derived by a second pure function and are additive —
a card can carry several.

| Badge | Source |
| ----- | ------ |
| `⊘ draft` | `isDraft` |
| `✖ changes requested` | `reviewDecision === 'CHANGES_REQUESTED'` |
| `✓✓ approved` | `reviewDecision === 'APPROVED'` |
| `N approvals` | count of `latestReviews` with state `APPROVED` |
| `N reviewers requested` | `reviewRequests.totalCount` |
| `● N failing` | count of failing contexts, capped per §5.2 |
| `◌ CI running` | `ci === 'pending'` |
| `✓ green` | `ci === 'success'` |
| `⚠ conflicts` | `mergeable === 'CONFLICTING'` |
| `⊙ merged` / `⊗ closed` | `state` |

There is deliberately **no "N of M approvals" badge.** The required-approval
count lives in branch protection, which this query does not fetch; showing a
denominator would mean either another request per repository or a guess. The
badge shows the numerator only.

## 7. User interface

### 7.1 Layout

```
┌──────────────────────────────────────────────────────────────┐
│ hubdash          [+ Add PR]   updated 4s ago  ↻   4,812 ⚡  ⚙ │
├────────────────┬────────────────────┬────────────────────────┤
│ Waiting      3 │ Needs action     3 │ Ready                2 │
│ ┌────────────┐ │ ┌────────────────┐ │ ┌────────────────────┐ │
│ │ #4821      │ │ │ #4790          │ │ │ #4755              │ │
│ │ graylog2…  │ │ │ ● 2 failing    │ │ │ ✓✓ approved ✓ green│ │
│ │ ◌ CI       │ │ └────────────────┘ │ └────────────────────┘ │
│ └────────────┘ │ ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ │                        │
│      …         │ ╎ #4830  ⊘ draft ╎ │                        │
├────────────────┴────────────────────┴────────────────────────┤
│ ▸ Archive (7)                                                │
└──────────────────────────────────────────────────────────────┘
```

The top bar shows the time since the last successful poll, a Refresh button, the
remaining rate-limit budget, and a settings affordance.

### 7.2 Components

| Component | Responsibility |
| --------- | -------------- |
| `App` | Composition root; owns board state and wires the poller |
| `TopBar` | Add button, refresh, freshness indicator, rate limit, settings |
| `Board` | Lays out the three columns and the archive section |
| `Column` | One column: title, count, ordered list of cards |
| `PrCard` | One PR: title, repo, number, author, badges, remove control |
| `ArchiveSection` | Collapsed-by-default section for merged and closed PRs |
| `AddPrDialog` | URL entry with inline validation |
| `SettingsDialog` | Token entry, validation, clear |
| `DropOverlay` | Full-window drop target shown during a drag |

### 7.3 Ordering within a column

`updatedAt` descending. In Needs action, non-drafts sort above all drafts; each
subgroup is then ordered by `updatedAt` descending, with a visual divider
between them.

### 7.4 Adding a PR

Three entry points funnel into one code path:

1. The **Add PR** button, opening a dialog with a URL field.
2. **Dragging a link** from any browser tab onto the window. The whole window is
   the drop target; a `DropOverlay` appears on `dragenter`. The dropped payload
   is read from the `text/uri-list` data transfer type, falling back to
   `text/plain`.
3. **Pasting** with the board focused.

All three call `parsePrUrl`, which accepts:

- `https://github.com/{owner}/{repo}/pull/{number}`
- the same with trailing path segments (`/files`, `/commits`) or a fragment
  (`#discussion_r123456`) or a query string
- the shorthand `{owner}/{repo}#{number}`
- the shorthand `{repo}#{number}` is **not** accepted; the owner is required

Anything else produces a typed error with a message naming what was wrong.

Adding a PR that is already tracked does not create a duplicate. The existing
card is scrolled into view and flashed instead.

### 7.5 Removing a PR

Each card has a remove control revealed on hover, which deletes the entry from
`hubdash.prs` immediately. There is no confirmation step — re-adding costs one
paste — and no undo. Archived cards are removed the same way; the archive is
never auto-pruned, because deciding when a merged PR stops being interesting is
the user's call, not the app's.

### 7.6 First run

With no token stored, the board renders empty with a single prompt to add one,
and no polling is attempted. With a token but no tracked PRs, it renders empty
with a prompt to add a PR.

## 8. Polling and refresh

```
  Refresh button ─┐
  15s interval ───┼─→ buildQuery(trackedPrs) ─→ one GraphQL POST
  window focus ───┘         │
                            └─→ normalise ─→ classify ─→ render
```

- The interval is **paused while the document is hidden** and a poll fires
  immediately on regaining focus, so a tab left open overnight neither burns
  budget nor shows stale data on return.
- A single **in-flight guard** prevents overlapping polls; a manual Refresh
  while a poll is running is a no-op rather than a second request.
- Changing the tracked list triggers an immediate poll rather than waiting for
  the next tick.
- Polling stops entirely when the tracked list is empty or no token is stored.
- **Archived PRs continue to be polled** along with everything else. Because
  the query cost does not grow per PR (§5.1) there is nothing to save by
  excluding them, and it means a reopened PR returns to its column on the next
  tick with no special case.

## 9. Error handling

Failures are handled at the granularity at which they occur.

| Failure | Behaviour |
| ------- | --------- |
| Network error or 5xx | Keep the last good board on screen. The freshness indicator turns amber and reads "last updated Ns ago". Retry on the next tick. |
| `401` / `403` from bad credentials | Persistent banner: the token is invalid or expired, with a link to the settings dialog. Polling stops until the token changes. |
| Rate limit exhausted | Banner naming the reset time from the `x-ratelimit-reset` response header. Polling backs off until then, or for a bounded fallback if the header is absent. |
| One aliased PR errors (deleted, renamed, or no access) | GraphQL returns partial data with an `errors` array. The other PRs render normally; that one card renders in an error state with the reason and its remove control. |
| Malformed `localStorage` | Treated as absent, replaced with the default, reported once. |

The distinction that matters: a **transport** failure must never blank the
board, and a **per-PR** failure must never take down its neighbours.

## 10. Module structure

```
src/
  github/
    parseUrl.ts        # string -> TrackedPr | ParseError
    buildQuery.ts      # TrackedPr[] -> GraphQL document + variables
    parseResponse.ts   # raw response -> NormalisedPr[] + PollErrors
    client.ts          # fetch, auth header, transport error mapping
  domain/
    classify.ts        # NormalisedPr -> Column
    badges.ts          # NormalisedPr -> Badge[]
    sort.ts            # ordering within a column
  storage/
    trackedPrs.ts      # validating load/save for hubdash.prs
    token.ts           # validating load/save for hubdash.token
  hooks/
    usePolling.ts      # interval, visibility, in-flight guard
    useTrackedPrs.ts   # tracked list state + persistence
  ui/
    App.tsx  TopBar.tsx  Board.tsx  Column.tsx  PrCard.tsx
    ArchiveSection.tsx  AddPrDialog.tsx  SettingsDialog.tsx
    DropOverlay.tsx
```

The boundary that earns its keep is between `github`/`domain` and `ui`. Every
interesting decision the app makes is a pure function over plain data, taking no
React and no `fetch`, and is therefore testable without a DOM or a network.
`usePolling` is the one place with unavoidable time-and-effect complexity, and it
is kept deliberately thin — a timer, a visibility listener, and a guard — because
it is the least pleasant layer to test.

## 11. Testing strategy

Development is test-first. The pure modules are specified by their tests before
they are written.

**`classify` — the highest-value tests.** A table of fixture PRs covering every
rule and, importantly, the collisions between them:

- merged; closed-unmerged
- failing CI; CI error; CI pending; CI success; no checks at all
- conflicting; `UNKNOWN` mergeability (must *not* be Needs action)
- changes requested; approved; review required; null review decision
- draft alone; draft with failing CI (Needs action via rule 2)
- approved **and** failing (Needs action, not Ready)
- approved **and** conflicting (Needs action, not Ready)
- approved with no checks (Ready, via the `none` branch of rule 6)

**`parseUrl`** — each accepted form in §7.4, plus rejections: a non-GitHub host,
an issue URL, a repo URL with no PR number, a non-numeric number, empty input,
and surrounding whitespace.

**`parseResponse`** — a full response, a partial response with an `errors` array,
a null `statusCheckRollup`, an empty `commits` list, and a PR with more than 100
contexts.

**`sort`** — ordering by `updatedAt`, and drafts placed last in Needs action.

**`storage`** — round-trip; and absent, non-JSON, wrong-shape, and wrong-version
values each yielding the default without throwing.

**Component tests** (Testing Library, `fetch` stubbed) — a card renders the
badges implied by its state; the add-PR dialog rejects a bad URL and accepts a
good one; a duplicate add does not create a second card; the archive starts
collapsed; the remove control removes a card.

**`usePolling`** — with fake timers: it does not poll while hidden, polls on
focus, and does not issue overlapping requests.

## 12. Deferred decisions

Recorded so they are not silently forgotten:

- **Backports.** A group holding the main PR plus a defined slot per target
  version, each slot tracking its own backport PR. Deferred because placement
  needs resolving first: a group's members disagree about which column they
  belong in, so either the group is classified as an aggregate and occupies one
  column, or groups live outside the three-column model.
- **Required-approval counts**, which would enable an "N of M approvals" badge
  and a more accurate Ready rule, at the cost of fetching branch protection.
- **Auto-discovery** of PRs by search, which would remove manual adding but
  changes the app's premise from a curated board to a feed.

## 13. Known follow-ups

Found by the final review and deliberately not fixed in the first version.
Recorded here because they are the durable record once the build workspace is
gone.

- **The reset time comes from the header, not the GraphQL field.** §9 originally
  named `rateLimit.resetAt`. That object only appears on a *successful*
  response, so it is precisely unavailable when the limit is hit; the
  implementation reads `x-ratelimit-reset` instead. §9 above now says so.
- **A shared dialog shell.** There are now three: `AddPrDialog`,
  `SettingsDialog` and `AddBackportGroupDialog`, each carrying ~73 lines of the
  same styled-component vocabulary — backdrop, panel, label, input, actions,
  eight components confirmed byte-identical across all three — plus the same
  Escape and reset-on-close effects. Still not extracted, for the reason that
  has held twice: the moment to do it is after the last review, not right after
  it with no further review wave, and one of the three contains a
  consent-critical cancellation guard.
- **A generic `usePersistedList<T>` and `loadEnvelope(...)`.** `useBackportGroups`
  and `useTrackedPrs` are now structurally near-identical — the same
  `initial`-ref → `useState` → ref-mirror → `commit` → `dismissStorageError`
  prologue — and so are their loaders, `loadBackportGroups` and
  `loadTrackedPrs`: read → parse → shape-guard → version-check → array-validate
  → reject with a `.corrupt` backup. One generic hook and one generic loader
  would collapse both pairs. Deferred for exactly the reason above: extracting
  either immediately after a final review, with no further review wave to catch
  a mistake, is the same risk this project has already declined twice for the
  dialog shell. **This is the top follow-up candidate for a future dedicated
  pass** — it is the largest duplication left, and it sits under persistence,
  where a silent mistake costs the user their tracked list.
- **A duplicate poll on each `canPoll` false→true transition.** When polling
  becomes possible again — token saved, first PR added, rate limit expired —
  two effects fire on the same commit and the second coalesces into one
  redundant follow-up request. User-paced and rare; one wasted request each.
- **`ArchiveSection` does not forward `flashedKey`.** Re-adding an already
  archived PR gives no feedback — no flash, no scroll — but only while the
  archive is expanded. Narrow, not unobservable.
- **A flashed `BackportGroupCard` does not scroll into view**, unlike
  `PrCard`, which flashes and scrolls. Re-adding an already-tracked main PR
  flashes the existing group card, but if it is off-screen the user may not
  see it happen. The same narrow gap as the `ArchiveSection` bullet above,
  and deferred for the same reason: adding untested scroll behaviour during a
  final review, with no further review wave to catch a mistake, was the
  worse trade.
- **`loadToken` reports a corrupt value without clearing it**, unlike
  `loadTrackedPrs`, which preserves the bad blob under `hubdash.prs.corrupt`
  and moves on. The token has no default to write, so the bad value survives
  reloads and is re-reported each time.
- **The default clock in `App` has no test.** `defaultNowMs` is module-scoped so
  its identity is stable, but every test injects `nowMs`, so a regression to a
  per-render function would be silent.
