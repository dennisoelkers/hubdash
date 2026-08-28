# hubdash — Detect Backport Versions from the Main PR's Body

**Date:** 2026-08-28
**Status:** Approved for implementation planning
**Extends:** `docs/superpowers/specs/2026-08-27-backports-tab-design.md` and `docs/superpowers/specs/2026-08-27-backports-tab-v2-design.md`

## 1. Purpose

Creating a backport group already asks for a main PR and a comma-separated list of target versions. Many PRs already say which versions they need to land in, somewhere in their own description — for example:

> This PR needs to be backported to `7.1`, `6.3` & `7.0`

Today the user retypes that by hand. This adds a background lookup, triggered as soon as the main PR field resolves to a real PR, that reads that PR's description and prefills the versions field when it finds a line like the one above.

## 2. Scope

**In scope**

- Detection runs only in `AddBackportGroupDialog`, when creating a new group. Adding a version to an *existing* group stays exactly as manual as it is today.
- A new, standalone, single-PR GraphQL request for the main PR's `body` — separate from the periodic board poll, since the group (and therefore the poll target) doesn't exist yet at the point detection needs to run.
- A pure text-matching rule (§3) that extracts version-shaped tokens from lines mentioning "backport".

**Out of scope**

- Re-detecting later if the PR's description is edited after the group is created.
- Any UI on `BackportGroupCard` for re-running detection on an existing group.
- Any version-shaped token that isn't on the same line as a "backport" mention (see §3's soft-wrap limitation).
- Sorting or otherwise reordering detected versions — see §3.

## 3. Detection rule

A pure function, `detectBackportVersions(body: string): string[]`, in `src/domain/detectBackportVersions.ts`.

1. Split `body` on literal newlines. GitHub's GraphQL `body` field returns the PR description's raw markdown source, and a single-line sentence like the example above is one line in that source regardless of how it wraps when rendered — the only real gap this creates is a description where the author hard-wrapped that exact sentence across two source lines. Accepted for v1; not attempted.
2. For every line whose lowercased text contains the substring `backport`, extract every version-shaped token from that line: one or more digits, a dot, one or more digits, optionally a second dot and more digits (`7.1`, `6.3.0`), with an optional leading `v`/`V` (`v7.1`). Whether the token is wrapped in backticks, followed by a comma, an ampersand, "and", or nothing at all makes no difference — the token is matched on its own shape, not its surrounding punctuation.
3. Collect matches across *every* matching line in the body, not just the first, in the order they appear — first in the line order, then in the order each token appears within its line.
4. Normalize each token by stripping a leading `v`/`V` (`v7.1` and `7.1` are the same version). De-duplicate on the normalized form, keeping each distinct version at the position of its *first* occurrence, normalized either way.
5. No matching line, or no version-shaped token on any matching line, returns `[]` — never an error; the caller treats this exactly like "detection found nothing."

**Order is preserved as written, not sorted.** This follows the same principle round 1 already established for manually-typed versions (`docs/superpowers/specs/2026-08-27-backports-tab-design.md` §6: "There is no version sorting, because version schemes vary and a wrong sort is worse than the order the user chose"). For the example in §1, detection produces `['7.1', '6.3', '7.0']`, in that order — not numerically sorted.

## 4. Fetching the PR body

`src/github/client.ts` gains `fetchPrBody`:

```ts
export type FetchPrBodyResult = { ok: true; body: string | null } | { ok: false; error: TransportError };

export async function fetchPrBody(
  token: string,
  pr: { owner: string; repo: string; number: number },
  options: FetchBoardOptions = {},
): Promise<FetchPrBodyResult>
```

It reuses the module's existing internal `post()` helper — the same one `fetchBoard` and `validateToken` already call — so every transport-level failure category (network, auth, rate limit, malformed response) is handled identically and by the same tested code, not reimplemented. The query itself is new and minimal, a single unaliased `repository(...) { pullRequest(...) { body } }` (`buildQuery.ts`'s existing `literal()` JSON-escaping helper is exported and reused for the owner/repo strings) — there is no batching concern here the way there is for the board poll, because this is always exactly one PR. A PR or repository that doesn't resolve, or a body GitHub returns as something other than a string, both come back as `{ ok: true, body: null }` — indistinguishable, from the caller's side, from a PR whose description is genuinely empty. This mirrors `validateToken`'s standalone-request pattern (`src/github/client.ts`), the codebase's only existing precedent for a GitHub request outside the unified board poll.

## 5. Dialog integration

`AddBackportGroupDialog` gains one new optional prop:

```ts
detectVersions?: (main: ParsedPr) => Promise<string[]>;
```

`App.tsx` composes and injects the real implementation — `fetchPrBody` (using its already-available `token` and `fetchImpl`) piped into `detectBackportVersions` — the same way `SettingsDialog`'s `validate` prop is composed and injected today. The dialog itself never imports GitHub-fetching code directly; it only knows it has an async function that resolves to a list of version strings, which keeps it trivially testable with a mock, exactly like `SettingsDialog.test.tsx` already mocks `validate`.

**Trigger:** as soon as the "Main pull request" field parses to a valid PR, and exactly once per distinct PR identity (owner/repo/number) — not once per keystroke, and not again for the same PR if the field is merely edited without changing which PR it resolves to. The dialog itself is rendered whether or not a token is set (it doesn't gate on that today), so `App.tsx`'s composed `detectVersions` is the thing responsible for the no-token case: it checks `token === null` first and resolves to `[]` immediately, before ever calling `fetchPrBody`. No `detectVersions` prop, or a URL that doesn't parse: no fetch attempt either way — field behaves exactly as it does today.

**While in flight:** the versions field's placeholder reads "Detecting…". Submitting the dialog is never blocked or delayed by an in-flight detection — if the user hits Track before it resolves, the group is created with whatever the versions field held at that moment, same as if detection had found nothing.

**Overwrite rule:** the moment the user types anything into the versions field themselves, detection stops writing to it for the rest of this dialog's open session — even if the URL field changes afterward to a different PR. This is a one-way flag, reset only when the dialog closes (bundled into the existing reset-on-close effect that already clears `url`/`versions`/`error`).

**Failure handling:** entirely silent. No error banner, no inline message — a failed fetch, a not-found PR, or a body with no detectable line all leave the versions field exactly as untouched manual entry works today. This is a convenience prefill layered on an already-complete manual flow, not a new validation gate; nothing about it should make the dialog feel less reliable when it doesn't find anything.

## 6. Testing

- `detectBackportVersions`: the example from §1; a bare (no-backtick) version list; a version prefixed with `v`; multiple matching lines; a version-shaped token on a line that does *not* mention "backport" (must not be picked up); no "backport" mention anywhere; an empty body; duplicate versions across two matching lines (deduplicated, first occurrence's position kept).
- `fetchPrBody`: a successful body, a PR that doesn't resolve (`body: null`), and that the existing transport-error categories (auth, rate limit, network, malformed) surface unchanged — via the shared `post()` helper, so this is mostly confirming the wiring, not re-testing `post()` itself.
- `AddBackportGroupDialog`: detection fills the versions field once a valid URL resolves; it does *not* fire again for the same PR on further edits that don't change the identity; it does *not* overwrite a field the user has already typed into; a rejected/empty detection leaves the field as-is with no error shown; submitting while detection is still in flight creates the group without waiting.

## 7. Deferred

- Re-detecting after the group already exists, or after the main PR's description changes.
- A visible "detected from PR body" indicator on the prefilled text.
- Any UI to re-run detection from an existing `BackportGroupCard`.
