# Tasks Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third tab, Tasks, reachable at `/tasks`, where the user tracks GitHub issues and pull requests as a single manually drag-reordered list with live status.

**Architecture:** Generalize the shared poll pipeline (`buildQuery`/`parseResponse`/`fetchBoard`) from `TrackedPr[]` to a new `TrackedTask[]` (owner/repo/number/addedAt plus a `kind: 'pr' | 'issue'` tag) so one GraphQL request keeps covering all three tabs. `PrEntry`'s shape is untouched — pr-kind results still land in `entries: PrEntry[]` exactly as today; a new `issueEntries: IssueEntry[]` array carries issue results. Everything Board/Backports-specific (`classify.ts`, `badges.ts`, `sort.ts`, `Column.tsx`, `PrCard.tsx`, `Board.tsx`, `BackportsTab.tsx`, and all of their tests) is untouched by this plan. New, Tasks-only code (storage, hook, dialog, row, tab) is added alongside it, and `App.tsx` wires the three tabs together at the end.

**Tech Stack:** React 19, TypeScript 5.7 (strict), Vite 6, styled-components 6, Vitest 3 + Testing Library, wouter (routing). No new dependency — drag-reordering uses the native HTML5 Drag and Drop API.

**Spec:** `docs/superpowers/specs/2026-09-03-tasks-tab-design.md`

## Global Constraints

- One GraphQL request per poll tick, covering Board + Backports + Tasks together — never split into a second request (spec §4).
- `PrEntry`'s shape does not change. Only `App.tsx` and new Tasks code read the new `issueEntries` array (spec §4, §6).
- `TrackedPr` itself is not modified. Board and Backports keep using it exactly as today; only the shared poll pipeline's parameter type changes, from `TrackedPr[]` to `TrackedTask[]` (spec §4).
- Tasks accepts full GitHub URLs only — no `owner/repo#N` shorthand (spec §7). `parsePrUrl` (used by the Pull Requests and Backports tabs) is not modified.
- Status is display-only on the Tasks tab. It never affects a task's position — order is exactly what's stored, in array order (spec §5, §6).
- Removal from Tasks is manual only — a merged PR or closed issue stays on the list until removed by hand (spec §3, §8).
- Every task in this plan bumps `package.json`'s patch version as its last step before committing, per this project's standing version-bump policy (0.9.2 → 0.9.3 → ...). Skip the bump only for a task that touches no shipped app code (there are none in this plan — every task ships something).

---

### Task 1: Types

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Produces: `TaskKind`, `TrackedTask`, `NormalisedIssue`, `IssueEntry`, and an updated `PollResult` — every later task in this plan imports from here.

- [ ] **Step 1: Add the new types**

Open `src/types.ts`. Immediately after the existing `BackportGroup` type (after the closing `};` of that type, before `/** Merge status of one slot... */`), add:

```ts
export type TaskKind = 'pr' | 'issue';

/**
 * A GitHub issue or PR tracked as a task. Also reused, unmodified, as the
 * generalized shape buildQuery/parseResponse/fetchBoard accept in place of
 * TrackedPr, so Board and Backports' existing TrackedPrs can join the same
 * poll by tagging themselves with kind: 'pr' at the one place they're merged
 * (see spec §4).
 */
export type TrackedTask = {
  kind: TaskKind;
  owner: string;
  repo: string;
  number: number;
  /** ISO 8601 timestamp of when it was added to the task list. */
  addedAt: string;
};

/** An issue after normalisation. Issues carry none of a PR's CI/review/draft signals. */
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

Then change the existing `PollResult` type from:

```ts
export type PollResult = {
  entries: PrEntry[];
  rateLimit: RateLimit | null;
};
```

to:

```ts
export type PollResult = {
  entries: PrEntry[];
  issueEntries: IssueEntry[];
  rateLimit: RateLimit | null;
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: one error, in `src/github/parseResponse.ts`, that the returned object is missing `issueEntries` — this is expected and fixed in Task 3. If there are any *other* errors, stop and investigate before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add TrackedTask, NormalisedIssue, and IssueEntry types

Prep for the Tasks tab (see spec at
docs/superpowers/specs/2026-09-03-tasks-tab-design.md). PollResult now
carries a second entries array; parseResponse is updated in the next
task."
```

---

### Task 2: Generalize `buildQuery` to `TrackedTask[]`

**Files:**
- Modify: `src/github/buildQuery.ts`
- Modify: `src/github/buildQuery.test.ts`

**Interfaces:**
- Consumes: `TrackedTask` from `../types` (Task 1).
- Produces: `buildQuery(targets: TrackedTask[]): string` — Task 4 (`client.ts`) calls this with the same `TrackedTask[]` it receives.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/github/buildQuery.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import type { TrackedTask } from '../types';
import { aliasFor, buildQuery } from './buildQuery';

const prs: TrackedTask[] = [
  {
    kind: 'pr',
    owner: 'Example',
    repo: 'example-server',
    number: 4821,
    addedAt: '2026-08-27T09:00:00Z',
  },
  {
    kind: 'pr',
    owner: 'Example',
    repo: 'example-plugin-enterprise',
    number: 912,
    addedAt: '2026-08-27T09:00:00Z',
  },
];

describe('aliasFor', () => {
  it('names the nth aliased field', () => {
    expect(aliasFor(0)).toBe('pr0');
    expect(aliasFor(12)).toBe('pr12');
  });
});

describe('buildQuery — pull requests', () => {
  it('always asks for the rate limit', () => {
    expect(buildQuery(prs)).toContain('rateLimit');
  });

  it('emits one aliased repository field per tracked PR', () => {
    const query = buildQuery(prs);
    expect(query).toContain('pr0: repository(owner: "Example", name: "example-server")');
    expect(query).toContain('pullRequest(number: 4821)');
    expect(query).toContain('pr1: repository(owner: "Example", name: "example-plugin-enterprise")');
    expect(query).toContain('pullRequest(number: 912)');
  });

  it('includes every field the normaliser needs', () => {
    const query = buildQuery(prs);
    for (const field of [
      'reviewDecision',
      'mergeable',
      'isDraft',
      'updatedAt',
      'statusCheckRollup',
      'latestReviews',
      'reviewRequests',
      'nameWithOwner',
      'baseRefName',
    ]) {
      expect(query, field).toContain(field);
    }
  });

  it('declares the PR fragment exactly once no matter how many PRs', () => {
    const occurrences = buildQuery(prs).match(/fragment prFields on PullRequest/g);
    expect(occurrences).toHaveLength(1);
  });

  it('does not declare the issue fragment when nothing tracked is an issue', () => {
    expect(buildQuery(prs)).not.toContain('fragment issueFields on Issue');
  });

  it('escapes owner and repo so a crafted name cannot break out of the string', () => {
    const query = buildQuery([
      { kind: 'pr', owner: 'a"b', repo: 'c\\d', number: 1, addedAt: '2026-08-27T09:00:00Z' },
    ]);
    expect(query).toContain('owner: "a\\"b"');
    expect(query).toContain('name: "c\\\\d"');
  });

  it('produces a valid query with no targets', () => {
    const query = buildQuery([]);
    expect(query).toContain('rateLimit');
    expect(query).not.toContain('pr0:');
    expect(query).not.toContain('fragment');
  });
});

describe('buildQuery — issues', () => {
  const issues: TrackedTask[] = [
    {
      kind: 'issue',
      owner: 'Example',
      repo: 'example-server',
      number: 55,
      addedAt: '2026-08-27T09:00:00Z',
    },
  ];

  it('aliases an issue-kind target to the issue field, not pullRequest', () => {
    const query = buildQuery(issues);
    expect(query).toContain('pr0: repository(owner: "Example", name: "example-server")');
    expect(query).toContain('issue(number: 55)');
    expect(query).not.toContain('pullRequest(number: 55)');
  });

  it('declares only the issue fragment when nothing tracked is a PR', () => {
    const query = buildQuery(issues);
    expect(query).toContain('fragment issueFields on Issue');
    expect(query).not.toContain('fragment prFields on PullRequest');
  });

  it('includes the fields the issue normaliser needs', () => {
    const query = buildQuery(issues);
    for (const field of ['title', 'url', 'state', 'updatedAt']) {
      expect(query, field).toContain(field);
    }
  });

  it('declares both fragments exactly once each for a mixed pr+issue query', () => {
    const query = buildQuery([...prs, ...issues]);
    expect(query.match(/fragment prFields on PullRequest/g)).toHaveLength(1);
    expect(query.match(/fragment issueFields on Issue/g)).toHaveLength(1);
    expect(query).toContain('pr2: repository(owner: "Example", name: "example-server")');
    expect(query).toContain('issue(number: 55)');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/github/buildQuery.test.ts`
Expected: FAIL — `buildQuery` still takes `TrackedPr[]` today and ignores `kind` entirely, so every target is aliased to `pullRequest(...)`. The new `buildQuery — issues` tests fail their assertions: there is no `issue(...)` field and no `issueFields` fragment yet.

- [ ] **Step 3: Rewrite `buildQuery.ts`**

Replace the full contents of `src/github/buildQuery.ts` with:

```ts
import type { TrackedTask } from '../types';

export function aliasFor(index: number): string {
  return `pr${index}`;
}

/** GraphQL string literals follow JSON's escaping rules. */
export function literal(value: string): string {
  return JSON.stringify(value);
}

const PR_FIELDS = `
fragment prFields on PullRequest {
  number
  title
  url
  state
  isDraft
  updatedAt
  author { login }
  baseRefName
  repository { nameWithOwner }
  reviewDecision
  mergeable
  reviewRequests(first: 20) { totalCount }
  latestReviews(first: 20) { nodes { state } }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          state
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
}`.trim();

/** Issues carry none of a PR's CI/review/mergeable/draft fields — see spec §6. */
const ISSUE_FIELDS = `
fragment issueFields on Issue {
  number
  title
  url
  state
  updatedAt
  author { login }
  repository { nameWithOwner }
}`.trim();

function fieldFor(target: TrackedTask, index: number): string {
  const selection =
    target.kind === 'issue'
      ? `issue(number: ${target.number}) { ...issueFields }`
      : `pullRequest(number: ${target.number}) { ...prFields }`;
  return (
    `  ${aliasFor(index)}: repository(owner: ${literal(target.owner)}, name: ${literal(target.repo)}) {\n` +
    `    ${selection}\n` +
    `  }`
  );
}

/**
 * One request for everything tracked across all three tabs, per spec §4.
 * Cost is one or two rate-limit points regardless of how many things are
 * tracked, so this must never be split into per-tab requests.
 */
export function buildQuery(targets: TrackedTask[]): string {
  const fields = targets.map(fieldFor).join('\n');

  const query = ['query Board {', '  rateLimit { limit cost remaining resetAt }', fields, '}']
    .filter((line) => line !== '')
    .join('\n');

  if (targets.length === 0) return query;

  const usesPr = targets.some((target) => target.kind === 'pr');
  const usesIssue = targets.some((target) => target.kind === 'issue');
  const fragments = [usesPr ? PR_FIELDS : '', usesIssue ? ISSUE_FIELDS : '']
    .filter((fragment) => fragment !== '')
    .join('\n\n');

  return `${query}\n\n${fragments}\n`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/github/buildQuery.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/github/buildQuery.ts src/github/buildQuery.test.ts
git commit -m "feat: generalize buildQuery to TrackedTask, add issue fragment"
```

---

### Task 3: Generalize `parseResponse` to `TrackedTask[]` and `issueEntries`

**Files:**
- Modify: `src/github/parseResponse.ts`
- Modify: `src/github/parseResponse.test.ts`

**Interfaces:**
- Consumes: `TrackedTask`, `NormalisedIssue`, `IssueEntry` from `../types` (Task 1); `aliasFor` from `./buildQuery` (Task 2, unchanged signature).
- Produces: `parseResponse(raw: unknown, targets: TrackedTask[]): ParseResponseResult`, where `ParseResponseResult`'s success case is `{ ok: true; result: PollResult }` with `PollResult.issueEntries: IssueEntry[]` populated. Task 4 (`client.ts`) calls this with the same `targets` it passed to `buildQuery`.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/github/parseResponse.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import type { TrackedTask } from '../types';
import { parseResponse } from './parseResponse';

const prs: TrackedTask[] = [
  {
    kind: 'pr',
    owner: 'Example',
    repo: 'example-server',
    number: 4821,
    addedAt: '2026-08-27T09:00:00Z',
  },
];

function rollup(state: string, nodes: unknown[] = []) {
  return {
    state,
    contexts: { totalCount: nodes.length, nodes },
  };
}

function prNode(overrides: Record<string, unknown> = {}, rollupValue: unknown = rollup('SUCCESS')) {
  return {
    number: 4821,
    title: 'Fix index rotation',
    url: 'https://github.com/Example/example-server/pull/4821',
    state: 'OPEN',
    isDraft: false,
    updatedAt: '2026-08-27T10:00:00Z',
    author: { login: 'octocat' },
    baseRefName: 'master',
    repository: { nameWithOwner: 'Example/example-server' },
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable: 'MERGEABLE',
    reviewRequests: { totalCount: 0 },
    latestReviews: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: rollupValue } }] },
    ...overrides,
  };
}

function issueNode(overrides: Record<string, unknown> = {}) {
  return {
    number: 55,
    title: 'Sort order is wrong on empty input',
    url: 'https://github.com/Example/example-server/issues/55',
    state: 'OPEN',
    updatedAt: '2026-08-27T10:00:00Z',
    author: { login: 'octocat' },
    repository: { nameWithOwner: 'Example/example-server' },
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}, errors?: unknown[]) {
  return {
    data: {
      rateLimit: { limit: 5000, cost: 1, remaining: 4812, resetAt: '2026-08-27T11:00:00Z' },
      pr0: { pullRequest: prNode() },
      ...overrides,
    },
    ...(errors ? { errors } : {}),
  };
}

function parseOk(raw: unknown, tracked: TrackedTask[] = prs) {
  const result = parseResponse(raw, tracked);
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return result.result;
}

describe('parseResponse — happy path', () => {
  it('normalises a PR', () => {
    const { entries, issueEntries } = parseOk(response());
    expect(entries).toHaveLength(1);
    expect(issueEntries).toHaveLength(0);
    const entry = entries[0];
    if (entry?.status !== 'ok') throw new Error('expected an ok entry');
    expect(entry.pr).toMatchObject({
      key: 'example/example-server#4821',
      owner: 'Example',
      repo: 'example-server',
      number: 4821,
      title: 'Fix index rotation',
      author: 'octocat',
      nameWithOwner: 'Example/example-server',
      baseRefName: 'master',
      lifecycle: 'OPEN',
      isDraft: false,
      reviewDecision: 'REVIEW_REQUIRED',
      mergeable: 'MERGEABLE',
      ci: 'success',
      failingCheckCount: 0,
      approvalCount: 0,
      requestedReviewerCount: 0,
    });
    // PrEntry.tracked stays exactly TrackedPr-shaped — no `kind` leaks in.
    expect(entry.tracked).toEqual({
      owner: 'Example',
      repo: 'example-server',
      number: 4821,
      addedAt: '2026-08-27T09:00:00Z',
    });
  });

  it('reads the rate limit', () => {
    expect(parseOk(response()).rateLimit).toEqual({
      limit: 5000,
      cost: 1,
      remaining: 4812,
      resetAt: '2026-08-27T11:00:00Z',
    });
  });

  it('tolerates a missing rate limit', () => {
    expect(parseOk(response({ rateLimit: null })).rateLimit).toBeNull();
  });

  it('counts approvals from latestReviews', () => {
    const raw = response({
      pr0: {
        pullRequest: prNode({
          latestReviews: {
            nodes: [{ state: 'APPROVED' }, { state: 'COMMENTED' }, { state: 'APPROVED' }],
          },
        }),
      },
    });
    const entry = parseOk(raw).entries[0];
    if (entry?.status !== 'ok') throw new Error('expected an ok entry');
    expect(entry.pr.approvalCount).toBe(2);
  });

  it('reads the requested reviewer count', () => {
    const raw = response({ pr0: { pullRequest: prNode({ reviewRequests: { totalCount: 3 } }) } });
    const entry = parseOk(raw).entries[0];
    if (entry?.status !== 'ok') throw new Error('expected an ok entry');
    expect(entry.pr.requestedReviewerCount).toBe(3);
  });
});

describe('parseResponse — CI normalisation', () => {
  function ciOf(rollupValue: unknown) {
    const entry = parseOk(response({ pr0: { pullRequest: prNode({}, rollupValue) } })).entries[0];
    if (entry?.status !== 'ok') throw new Error('expected an ok entry');
    return { ci: entry.pr.ci, failing: entry.pr.failingCheckCount };
  }

  it('maps a null rollup to "none", not to a failure', () => {
    expect(ciOf(null).ci).toBe('none');
  });

  it('maps an absent commits list to "none"', () => {
    const raw = response({ pr0: { pullRequest: prNode({ commits: { nodes: [] } }) } });
    const entry = parseOk(raw).entries[0];
    if (entry?.status !== 'ok') throw new Error('expected an ok entry');
    expect(entry.pr.ci).toBe('none');
  });

  it('maps SUCCESS, FAILURE, ERROR, PENDING and EXPECTED', () => {
    expect(ciOf(rollup('SUCCESS')).ci).toBe('success');
    expect(ciOf(rollup('FAILURE')).ci).toBe('failure');
    expect(ciOf(rollup('ERROR')).ci).toBe('failure');
    expect(ciOf(rollup('PENDING')).ci).toBe('pending');
    expect(ciOf(rollup('EXPECTED')).ci).toBe('pending');
  });

  it('maps an unrecognised rollup state to pending rather than green or red', () => {
    expect(ciOf(rollup('SOMETHING_NEW')).ci).toBe('pending');
  });

  it('counts failing check runs and status contexts', () => {
    const nodes = [
      { __typename: 'CheckRun', name: 'unit', conclusion: 'FAILURE', status: 'COMPLETED' },
      { __typename: 'CheckRun', name: 'lint', conclusion: 'TIMED_OUT', status: 'COMPLETED' },
      { __typename: 'CheckRun', name: 'ok', conclusion: 'SUCCESS', status: 'COMPLETED' },
      { __typename: 'CheckRun', name: 'skipped', conclusion: 'SKIPPED', status: 'COMPLETED' },
      { __typename: 'StatusContext', context: 'ci/legacy', state: 'FAILURE' },
      { __typename: 'StatusContext', context: 'ci/other', state: 'SUCCESS' },
    ];
    expect(ciOf(rollup('FAILURE', nodes))).toEqual({ ci: 'failure', failing: 3 });
  });

  it('does not count a neutral or skipped conclusion as failing', () => {
    const nodes = [
      { __typename: 'CheckRun', name: 'n', conclusion: 'NEUTRAL', status: 'COMPLETED' },
      { __typename: 'CheckRun', name: 's', conclusion: 'SKIPPED', status: 'COMPLETED' },
    ];
    expect(ciOf(rollup('SUCCESS', nodes)).failing).toBe(0);
  });

  it('reports a red rollup with no visible failing context as failing with a zero count', () => {
    expect(ciOf(rollup('FAILURE', []))).toEqual({ ci: 'failure', failing: 0 });
  });
});

describe('parseResponse — per-PR failures', () => {
  it('marks a PR errored when its alias came back null', () => {
    const entry = parseOk(response({ pr0: null })).entries[0];
    if (entry?.status !== 'error') throw new Error('expected an error entry');
    expect(entry.key).toBe('example/example-server#4821');
    expect(entry.message).toBeTruthy();
  });

  it('marks a PR errored when the repository resolved but the PR did not', () => {
    const entry = parseOk(response({ pr0: { pullRequest: null } })).entries[0];
    expect(entry?.status).toBe('error');
  });

  it('uses the GraphQL error message when one names the alias', () => {
    const raw = response({ pr0: null }, [
      { message: 'Could not resolve to a Repository with the name.', path: ['pr0'] },
    ]);
    const entry = parseOk(raw).entries[0];
    if (entry?.status !== 'error') throw new Error('expected an error entry');
    expect(entry.message).toBe('Could not resolve to a Repository with the name.');
  });

  it('lets healthy PRs through when a sibling fails', () => {
    const two: TrackedTask[] = [
      ...prs,
      { kind: 'pr', owner: 'Example', repo: 'gone', number: 1, addedAt: '2026-08-27T09:00:00Z' },
    ];
    const raw = response({ pr1: null }, [{ message: 'Not found', path: ['pr1'] }]);
    const { entries } = parseOk(raw, two);
    expect(entries[0]?.status).toBe('ok');
    expect(entries[1]?.status).toBe('error');
  });

  it('returns one entry per tracked PR, in tracked order', () => {
    const two: TrackedTask[] = [
      ...prs,
      { kind: 'pr', owner: 'Example', repo: 'other', number: 7, addedAt: '2026-08-27T09:00:00Z' },
    ];
    const { entries } = parseOk(response(), two);
    expect(entries.map((entry) => entry.tracked.number)).toEqual([4821, 7]);
  });
});

describe('parseResponse — issues', () => {
  const issueTarget: TrackedTask = {
    kind: 'issue',
    owner: 'Example',
    repo: 'example-server',
    number: 55,
    addedAt: '2026-08-27T09:00:00Z',
  };

  it('normalises an issue into issueEntries, not entries', () => {
    const raw = response({ pr0: { issue: issueNode() } });
    const { entries, issueEntries } = parseOk(raw, [issueTarget]);
    expect(entries).toHaveLength(0);
    expect(issueEntries).toHaveLength(1);
    const entry = issueEntries[0];
    if (entry?.status !== 'ok') throw new Error('expected an ok entry');
    expect(entry.issue).toEqual({
      key: 'example/example-server#55',
      owner: 'Example',
      repo: 'example-server',
      number: 55,
      title: 'Sort order is wrong on empty input',
      url: 'https://github.com/Example/example-server/issues/55',
      author: 'octocat',
      nameWithOwner: 'Example/example-server',
      updatedAt: '2026-08-27T10:00:00Z',
      lifecycle: 'OPEN',
    });
  });

  it('maps a CLOSED issue state to lifecycle CLOSED', () => {
    const raw = response({ pr0: { issue: issueNode({ state: 'CLOSED' }) } });
    const entry = parseOk(raw, [issueTarget]).issueEntries[0];
    if (entry?.status !== 'ok') throw new Error('expected an ok entry');
    expect(entry.issue.lifecycle).toBe('CLOSED');
  });

  it('marks an issue errored when its alias came back null', () => {
    const raw = response({ pr0: null });
    const entry = parseOk(raw, [issueTarget]).issueEntries[0];
    if (entry?.status !== 'error') throw new Error('expected an error entry');
    expect(entry.message).toBeTruthy();
  });

  it('marks an issue errored when the repository resolved but the issue did not', () => {
    const raw = response({ pr0: { issue: null } });
    const entry = parseOk(raw, [issueTarget]).issueEntries[0];
    expect(entry?.status).toBe('error');
  });

  it('splits a mixed pr+issue response into the two arrays, in tracked order', () => {
    const raw = response({ pr0: { pullRequest: prNode() }, pr1: { issue: issueNode() } });
    const { entries, issueEntries } = parseOk(raw, [...prs, issueTarget]);
    expect(entries).toHaveLength(1);
    expect(issueEntries).toHaveLength(1);
    expect(entries[0]?.key).toBe('example/example-server#4821');
    expect(issueEntries[0]?.key).toBe('example/example-server#55');
  });
});

describe('parseResponse — malformed payloads', () => {
  it('fails when there is no data object', () => {
    expect(parseResponse({ errors: [{ message: 'Bad credentials' }] }, prs).ok).toBe(false);
    expect(parseResponse({}, prs).ok).toBe(false);
    expect(parseResponse(null, prs).ok).toBe(false);
    expect(parseResponse('nonsense', prs).ok).toBe(false);
  });

  it('surfaces the first top-level error message when data is absent', () => {
    const result = parseResponse({ errors: [{ message: 'Bad credentials' }] }, prs);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('Bad credentials');
  });

  it('marks a PR errored rather than failing the poll when its node is not an object', () => {
    const entry = parseOk(response({ pr0: { pullRequest: 42 } })).entries[0];
    expect(entry?.status).toBe('error');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/github/parseResponse.test.ts`
Expected: FAIL — `parseResponse` still takes `TrackedPr[]` and never produces `issueEntries`.

- [ ] **Step 3: Rewrite `parseResponse.ts`**

Replace the full contents of `src/github/parseResponse.ts` with:

```ts
import { prKey } from '../domain/prKey';
import type {
  CiState,
  IssueEntry,
  MergeableState,
  NormalisedIssue,
  NormalisedPr,
  PollResult,
  PrEntry,
  PrLifecycle,
  RateLimit,
  ReviewDecision,
  TrackedPr,
  TrackedTask,
} from '../types';
import { aliasFor } from './buildQuery';
import { asRecord } from './json';

export type ParseResponseResult = { ok: true; result: PollResult } | { ok: false; error: string };

const FAILING_CONCLUSIONS = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'STARTUP_FAILURE',
  'ACTION_REQUIRED',
]);
const FAILING_STATES = new Set(['FAILURE', 'ERROR']);

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * The `OPEN` fallback is defensive only, and in practice unreachable: GitHub's
 * `PullRequestState` is non-null, so a value we do not recognise means the
 * whole `pullRequest` selection came back null and the caller has already
 * turned the entry into an errored one. Kept because the alternative is a
 * throw, and this file's contract is that a surprising payload degrades a card
 * rather than the board.
 */
function asLifecycle(value: unknown): PrLifecycle {
  return value === 'MERGED' || value === 'CLOSED' ? value : 'OPEN';
}

/** Same reasoning as `asLifecycle`, for `IssueState` — which has no MERGED. */
function asIssueLifecycle(value: unknown): 'OPEN' | 'CLOSED' {
  return value === 'CLOSED' ? 'CLOSED' : 'OPEN';
}

function asReviewDecision(value: unknown): ReviewDecision {
  return value === 'APPROVED' || value === 'CHANGES_REQUESTED' || value === 'REVIEW_REQUIRED'
    ? value
    : null;
}

function asMergeable(value: unknown): MergeableState {
  return value === 'MERGEABLE' || value === 'CONFLICTING' ? value : 'UNKNOWN';
}

/**
 * A null rollup means the PR has no checks at all — modelled as `none`, never
 * folded into failure or pending (spec §5.2). An unrecognised state maps to
 * `pending`, because claiming green or red on a value we do not understand is
 * worse than admitting we are still waiting.
 */
function normaliseCi(rollup: Record<string, unknown> | null): {
  ci: CiState;
  failingCheckCount: number;
} {
  if (!rollup) return { ci: 'none', failingCheckCount: 0 };

  const contexts = asRecord(rollup.contexts);
  const nodes = Array.isArray(contexts?.nodes) ? contexts.nodes : [];
  const failingCheckCount = nodes.filter((node) => {
    const context = asRecord(node);
    if (!context) return false;
    if (typeof context.conclusion === 'string') return FAILING_CONCLUSIONS.has(context.conclusion);
    if (typeof context.state === 'string') return FAILING_STATES.has(context.state);
    return false;
  }).length;

  switch (rollup.state) {
    case 'SUCCESS':
      return { ci: 'success', failingCheckCount: 0 };
    case 'FAILURE':
    case 'ERROR':
      return { ci: 'failure', failingCheckCount };
    default:
      return { ci: 'pending', failingCheckCount: 0 };
  }
}

function rollupOf(node: Record<string, unknown>): Record<string, unknown> | null {
  const commits = asRecord(node.commits);
  const nodes = Array.isArray(commits?.nodes) ? commits.nodes : [];
  const first = asRecord(nodes[0]);
  const commit = asRecord(first?.commit);
  return asRecord(commit?.statusCheckRollup);
}

function normalisePr(node: Record<string, unknown>, tracked: TrackedPr): NormalisedPr {
  const { ci, failingCheckCount } = normaliseCi(rollupOf(node));
  const latestReviews = asRecord(node.latestReviews);
  const reviewNodes = Array.isArray(latestReviews?.nodes) ? latestReviews.nodes : [];
  const reviewRequests = asRecord(node.reviewRequests);

  return {
    key: prKey(tracked.owner, tracked.repo, tracked.number),
    owner: tracked.owner,
    repo: tracked.repo,
    number: asNumber(node.number, tracked.number),
    title: asString(node.title, `#${tracked.number}`),
    url: asString(
      node.url,
      `https://github.com/${tracked.owner}/${tracked.repo}/pull/${tracked.number}`,
    ),
    author: asString(asRecord(node.author)?.login, 'unknown'),
    nameWithOwner: asString(
      asRecord(node.repository)?.nameWithOwner,
      `${tracked.owner}/${tracked.repo}`,
    ),
    baseRefName: asString(node.baseRefName, ''),
    updatedAt: asString(node.updatedAt, tracked.addedAt),
    lifecycle: asLifecycle(node.state),
    isDraft: node.isDraft === true,
    reviewDecision: asReviewDecision(node.reviewDecision),
    mergeable: asMergeable(node.mergeable),
    ci,
    failingCheckCount,
    approvalCount: reviewNodes.filter((review) => asRecord(review)?.state === 'APPROVED').length,
    requestedReviewerCount: asNumber(reviewRequests?.totalCount, 0),
  };
}

function normaliseIssue(node: Record<string, unknown>, tracked: TrackedTask): NormalisedIssue {
  return {
    key: prKey(tracked.owner, tracked.repo, tracked.number),
    owner: tracked.owner,
    repo: tracked.repo,
    number: asNumber(node.number, tracked.number),
    title: asString(node.title, `#${tracked.number}`),
    url: asString(
      node.url,
      `https://github.com/${tracked.owner}/${tracked.repo}/issues/${tracked.number}`,
    ),
    author: asString(asRecord(node.author)?.login, 'unknown'),
    nameWithOwner: asString(
      asRecord(node.repository)?.nameWithOwner,
      `${tracked.owner}/${tracked.repo}`,
    ),
    updatedAt: asString(node.updatedAt, tracked.addedAt),
    lifecycle: asIssueLifecycle(node.state),
  };
}

function normaliseRateLimit(value: unknown): RateLimit | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    limit: asNumber(record.limit, 0),
    cost: asNumber(record.cost, 0),
    remaining: asNumber(record.remaining, 0),
    resetAt: asString(record.resetAt, ''),
  };
}

/** Maps `pr3` -> the message of the first GraphQL error whose path starts there. */
function errorsByAlias(raw: Record<string, unknown>): Map<string, string> {
  const byAlias = new Map<string, string>();
  if (!Array.isArray(raw.errors)) return byAlias;

  for (const item of raw.errors) {
    const error = asRecord(item);
    if (!error || !Array.isArray(error.path)) continue;
    const alias = error.path[0];
    if (typeof alias !== 'string' || byAlias.has(alias)) continue;
    byAlias.set(alias, asString(error.message, 'This could not be loaded.'));
  }
  return byAlias;
}

function firstErrorMessage(raw: Record<string, unknown>): string | null {
  if (!Array.isArray(raw.errors)) return null;
  for (const item of raw.errors) {
    const message = asRecord(item)?.message;
    if (typeof message === 'string' && message !== '') return message;
  }
  return null;
}

/** Strips `kind` back off so `PrEntry.tracked` stays exactly `TrackedPr`-shaped. */
function stripKind(task: TrackedTask): TrackedPr {
  return { owner: task.owner, repo: task.repo, number: task.number, addedAt: task.addedAt };
}

/**
 * Turns one poll response into entries, one per tracked task in tracked
 * order. A pr-kind target produces a PrEntry (unchanged shape); an
 * issue-kind target produces an IssueEntry in the separate `issueEntries`
 * array (spec §4, §6). Something that failed to resolve on its own becomes
 * an errored entry; only a payload with no usable `data` fails the whole poll.
 */
export function parseResponse(raw: unknown, targets: TrackedTask[]): ParseResponseResult {
  const envelope = asRecord(raw);
  if (!envelope) {
    return { ok: false, error: 'GitHub returned a response that could not be read.' };
  }

  const data = asRecord(envelope.data);
  if (!data) {
    const message = firstErrorMessage(envelope);
    return {
      ok: false,
      error: message
        ? `GitHub rejected the request: ${message}`
        : 'GitHub returned a response with no data.',
    };
  }

  const aliasErrors = errorsByAlias(envelope);

  const entries: PrEntry[] = [];
  const issueEntries: IssueEntry[] = [];

  targets.forEach((tracked, index) => {
    const alias = aliasFor(index);
    const key = prKey(tracked.owner, tracked.repo, tracked.number);
    const repository = asRecord(data[alias]);

    if (tracked.kind === 'issue') {
      const node = asRecord(repository?.issue);
      if (!node) {
        issueEntries.push({
          status: 'error',
          key,
          tracked,
          message:
            aliasErrors.get(alias) ??
            'This issue could not be loaded. It may have been deleted, or the token may not have access.',
        });
        return;
      }
      issueEntries.push({ status: 'ok', key, tracked, issue: normaliseIssue(node, tracked) });
      return;
    }

    const trackedPr = stripKind(tracked);
    const node = asRecord(repository?.pullRequest);
    if (!node) {
      entries.push({
        status: 'error',
        key,
        tracked: trackedPr,
        message:
          aliasErrors.get(alias) ??
          'This pull request could not be loaded. It may have been deleted, or the token may not have access.',
      });
      return;
    }
    entries.push({ status: 'ok', key, tracked: trackedPr, pr: normalisePr(node, trackedPr) });
  });

  return {
    ok: true,
    result: { entries, issueEntries, rateLimit: normaliseRateLimit(data.rateLimit) },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/github/parseResponse.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (Task 1's `PollResult` mismatch is now resolved). If `client.ts` shows an error about `TrackedPr[]` vs `TrackedTask[]`, that's expected — fixed in Task 4.

- [ ] **Step 6: Commit**

```bash
git add src/github/parseResponse.ts src/github/parseResponse.test.ts
git commit -m "feat: generalize parseResponse to TrackedTask, split off issueEntries"
```

---

### Task 4: Generalize `fetchBoard` to `TrackedTask[]`

**Files:**
- Modify: `src/github/client.ts`
- Modify: `src/github/client.test.ts`

**Interfaces:**
- Consumes: `buildQuery(targets: TrackedTask[])` (Task 2), `parseResponse(raw, targets: TrackedTask[])` (Task 3).
- Produces: `fetchBoard(token: string, targets: TrackedTask[], options?: FetchBoardOptions): Promise<FetchOutcome>` — Task 14 (`App.tsx`) calls this with its generalized `pollTargets`.

- [ ] **Step 1: Update `client.test.ts`'s fixtures**

In `src/github/client.test.ts`, change the import and the `prs` fixture from:

```ts
import type { TrackedPr } from '../types';
```

```ts
const prs: TrackedPr[] = [
  { owner: 'Example', repo: 'example-server', number: 4821, addedAt: '2026-08-27T09:00:00Z' },
];
```

to:

```ts
import type { TrackedTask } from '../types';
```

```ts
const prs: TrackedTask[] = [
  {
    kind: 'pr',
    owner: 'Example',
    repo: 'example-server',
    number: 4821,
    addedAt: '2026-08-27T09:00:00Z',
  },
];
```

Every other use of `prs` in the file (`fetchBoard('ghp_example', prs, ...)`, etc.) is unchanged — they all reference this one constant.

- [ ] **Step 2: Verify this is caught by the typechecker, not the test runner**

This task changes only a type annotation — `fetchBoard`'s existing body already forwards its second argument untouched into `buildQuery`/`parseResponse` (both already generalized in Tasks 2-3), so the actual runtime behavior is already correct and `vitest run` alone will not catch the mismatch (Vite/Vitest strip types without checking them). Use the typechecker instead:

Run: `npx tsc --noEmit`
Expected: FAIL — an error in `src/github/client.ts` where `fetchBoard` passes its `TrackedPr[]`-typed parameter into `buildQuery`/`parseResponse`, both of which now require `TrackedTask[]`.

- [ ] **Step 3: Update `fetchBoard`'s signature**

In `src/github/client.ts`, change the import line:

```ts
import type { FetchOutcome, TrackedPr, TransportError } from '../types';
```

to:

```ts
import type { FetchOutcome, TrackedTask, TransportError } from '../types';
```

and change the `fetchBoard` function from:

```ts
export async function fetchBoard(
  token: string,
  prs: TrackedPr[],
  options: FetchBoardOptions = {},
): Promise<FetchOutcome> {
  const posted = await post(token, buildQuery(prs), options);
  if (!posted.ok) return { ok: false, error: posted.error };

  const parsed = parseResponse(posted.body, prs);
  if (!parsed.ok) return { ok: false, error: { kind: 'malformed', message: parsed.error } };

  return { ok: true, result: parsed.result };
}
```

to:

```ts
export async function fetchBoard(
  token: string,
  targets: TrackedTask[],
  options: FetchBoardOptions = {},
): Promise<FetchOutcome> {
  const posted = await post(token, buildQuery(targets), options);
  if (!posted.ok) return { ok: false, error: posted.error };

  const parsed = parseResponse(posted.body, targets);
  if (!parsed.ok) return { ok: false, error: { kind: 'malformed', message: parsed.error } };

  return { ok: true, result: parsed.result };
}
```

`fetchPrBody` and `validateToken` are untouched — neither takes a `TrackedPr[]`/`TrackedTask[]` list.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/github/client.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck clean. `App.tsx` will now show a type error where it calls `fetchBoard`/builds `pollTargets` with `TrackedPr[]` — that's expected and fixed in Task 14. Every other test file passes unchanged.

- [ ] **Step 6: Bump the version and commit**

Bump `package.json`'s `"version"` field's patch number by one (see Global Constraints).

```bash
git add src/github/client.ts src/github/client.test.ts package.json
git commit -m "feat: generalize fetchBoard to accept TrackedTask

App.tsx's pollTargets still builds TrackedPr[] at this point in the
plan; that's fixed when the Tasks tab is wired in (final task)."
```

---

### Task 5: `classifyIssue`

**Files:**
- Create: `src/domain/classifyIssue.ts`
- Test: `src/domain/classifyIssue.test.ts`

**Interfaces:**
- Consumes: `NormalisedIssue` from `../types` (Task 1).
- Produces: `classifyIssue(issue: NormalisedIssue): 'waiting' | 'archive'` — used by Task 6 (`taskStatus.ts`).

- [ ] **Step 1: Write the failing test**

Create `src/domain/classifyIssue.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { NormalisedIssue } from '../types';
import { classifyIssue } from './classifyIssue';

function makeIssue(overrides: Partial<NormalisedIssue> = {}): NormalisedIssue {
  return {
    key: 'example/example-server#55',
    owner: 'Example',
    repo: 'example-server',
    number: 55,
    title: 'Sort order is wrong on empty input',
    url: 'https://github.com/Example/example-server/issues/55',
    author: 'octocat',
    nameWithOwner: 'Example/example-server',
    updatedAt: '2026-08-27T10:00:00Z',
    lifecycle: 'OPEN',
    ...overrides,
  };
}

describe('classifyIssue', () => {
  it('classifies an open issue as waiting', () => {
    expect(classifyIssue(makeIssue({ lifecycle: 'OPEN' }))).toBe('waiting');
  });

  it('classifies a closed issue as archive', () => {
    expect(classifyIssue(makeIssue({ lifecycle: 'CLOSED' }))).toBe('archive');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/classifyIssue.test.ts`
Expected: FAIL with "Cannot find module './classifyIssue'".

- [ ] **Step 3: Write the implementation**

Create `src/domain/classifyIssue.ts`:

```ts
import type { NormalisedIssue } from '../types';

/**
 * Issues carry none of the CI/review/mergeable/draft signals classify() for
 * PRs depends on, so this is a plain two-state model: whether it's still
 * open. `needsAction`/`ready` never apply to an issue in this app (spec §6).
 */
export function classifyIssue(issue: NormalisedIssue): 'waiting' | 'archive' {
  return issue.lifecycle === 'CLOSED' ? 'archive' : 'waiting';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/classifyIssue.test.ts`
Expected: PASS.

- [ ] **Step 5: Bump the version and commit**

Bump `package.json`'s patch version.

```bash
git add src/domain/classifyIssue.ts src/domain/classifyIssue.test.ts package.json
git commit -m "feat: add classifyIssue, a two-state open/closed classifier"
```

---

### Task 6: `taskStatusFor`

**Files:**
- Create: `src/domain/taskStatus.ts`
- Test: `src/domain/taskStatus.test.ts`

**Interfaces:**
- Consumes: `classify` from `./classify` (existing, unchanged), `classifyIssue` from `./classifyIssue` (Task 5), `PrEntry`/`IssueEntry` from `../types` (Task 1, existing).
- Produces: `TaskStatus` (a discriminated union: `{kind:'pending'}`, `{kind:'errored', message}`, `{kind:'waiting'}`, `{kind:'needsAction'}`, `{kind:'ready'}`, `{kind:'merged'}`, `{kind:'closed'}`) and `taskStatusFor(entry: PrEntry | IssueEntry | undefined): TaskStatus` — used by Task 10 (`TaskRow.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `src/domain/taskStatus.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makePr } from '../test/makePr';
import type { IssueEntry, NormalisedIssue, PrEntry } from '../types';
import { taskStatusFor } from './taskStatus';

function okPrEntry(overrides: Parameters<typeof makePr>[0] = {}): PrEntry {
  const pr = makePr(overrides);
  return { status: 'ok', key: pr.key, tracked: { ...pr, addedAt: pr.updatedAt }, pr };
}

function makeIssue(overrides: Partial<NormalisedIssue> = {}): NormalisedIssue {
  return {
    key: 'example/example-server#55',
    owner: 'Example',
    repo: 'example-server',
    number: 55,
    title: 'Sort order is wrong on empty input',
    url: 'https://github.com/Example/example-server/issues/55',
    author: 'octocat',
    nameWithOwner: 'Example/example-server',
    updatedAt: '2026-08-27T10:00:00Z',
    lifecycle: 'OPEN',
    ...overrides,
  };
}

function okIssueEntry(overrides: Partial<NormalisedIssue> = {}): IssueEntry {
  const issue = makeIssue(overrides);
  return {
    status: 'ok',
    key: issue.key,
    tracked: { kind: 'issue', owner: issue.owner, repo: issue.repo, number: issue.number, addedAt: issue.updatedAt },
    issue,
  };
}

describe('taskStatusFor — no data yet', () => {
  it('reports pending when the entry is undefined', () => {
    expect(taskStatusFor(undefined)).toEqual({ kind: 'pending' });
  });
});

describe('taskStatusFor — errored entries', () => {
  it('carries the message through for an errored PR entry', () => {
    const entry: PrEntry = {
      status: 'error',
      key: 'example/example-server#4821',
      tracked: { owner: 'Example', repo: 'example-server', number: 4821, addedAt: '2026-08-27T09:00:00Z' },
      message: 'This pull request could not be loaded.',
    };
    expect(taskStatusFor(entry)).toEqual({
      kind: 'errored',
      message: 'This pull request could not be loaded.',
    });
  });

  it('carries the message through for an errored issue entry', () => {
    const entry: IssueEntry = {
      status: 'error',
      key: 'example/example-server#55',
      tracked: { kind: 'issue', owner: 'Example', repo: 'example-server', number: 55, addedAt: '2026-08-27T09:00:00Z' },
      message: 'This issue could not be loaded.',
    };
    expect(taskStatusFor(entry)).toEqual({ kind: 'errored', message: 'This issue could not be loaded.' });
  });
});

describe('taskStatusFor — PR entries reuse classify()', () => {
  it('reports merged for a merged PR, not classify()’s archive bucket', () => {
    expect(taskStatusFor(okPrEntry({ lifecycle: 'MERGED' }))).toEqual({ kind: 'merged' });
  });

  it('reports closed for a closed, unmerged PR', () => {
    expect(taskStatusFor(okPrEntry({ lifecycle: 'CLOSED' }))).toEqual({ kind: 'closed' });
  });

  it('reports needsAction for an open PR with changes requested', () => {
    expect(
      taskStatusFor(okPrEntry({ reviewDecision: 'CHANGES_REQUESTED', requestedReviewerCount: 0 })),
    ).toEqual({ kind: 'needsAction' });
  });

  it('reports ready for an approved, green PR', () => {
    expect(taskStatusFor(okPrEntry({ reviewDecision: 'APPROVED', ci: 'success' }))).toEqual({
      kind: 'ready',
    });
  });

  it('reports waiting for an unreviewed PR', () => {
    expect(taskStatusFor(okPrEntry())).toEqual({ kind: 'waiting' });
  });
});

describe('taskStatusFor — issue entries use classifyIssue()', () => {
  it('reports waiting for an open issue', () => {
    expect(taskStatusFor(okIssueEntry({ lifecycle: 'OPEN' }))).toEqual({ kind: 'waiting' });
  });

  it('reports closed for a closed issue', () => {
    expect(taskStatusFor(okIssueEntry({ lifecycle: 'CLOSED' }))).toEqual({ kind: 'closed' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/domain/taskStatus.test.ts`
Expected: FAIL with "Cannot find module './taskStatus'".

- [ ] **Step 3: Write the implementation**

Create `src/domain/taskStatus.ts`:

```ts
import type { IssueEntry, PrEntry } from '../types';
import { classify } from './classify';
import { classifyIssue } from './classifyIssue';

export type TaskStatus =
  | { kind: 'pending' }
  | { kind: 'errored'; message: string }
  | { kind: 'waiting' }
  | { kind: 'needsAction' }
  | { kind: 'ready' }
  | { kind: 'merged' }
  | { kind: 'closed' };

/**
 * A task's display status, per spec §6. `entry` is undefined until the
 * first poll for it resolves, mirroring how the Backports tab treats a slot
 * with no data yet. Status is display-only — it never affects a task's
 * position in the list.
 */
export function taskStatusFor(entry: PrEntry | IssueEntry | undefined): TaskStatus {
  if (entry === undefined) return { kind: 'pending' };
  if (entry.status === 'error') return { kind: 'errored', message: entry.message };

  if ('pr' in entry) {
    if (entry.pr.lifecycle === 'MERGED') return { kind: 'merged' };
    if (entry.pr.lifecycle === 'CLOSED') return { kind: 'closed' };
    const column = classify(entry.pr);
    if (column === 'waiting' || column === 'needsAction' || column === 'ready') {
      return { kind: column };
    }
    // Unreachable: classify() only returns 'archive' for MERGED/CLOSED PRs,
    // both handled above.
    return { kind: 'waiting' };
  }

  return classifyIssue(entry.issue) === 'archive' ? { kind: 'closed' } : { kind: 'waiting' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/domain/taskStatus.test.ts`
Expected: PASS.

- [ ] **Step 5: Bump the version and commit**

```bash
git add src/domain/taskStatus.ts src/domain/taskStatus.test.ts package.json
git commit -m "feat: add taskStatusFor, the five-state display status for tasks"
```

(Bump `package.json`'s patch version before staging it, as in every prior task.)

---

### Task 7: `parseTaskUrl`

**Files:**
- Create: `src/github/parseTaskUrl.ts`
- Test: `src/github/parseTaskUrl.test.ts`

**Interfaces:**
- Consumes: `TaskKind` from `../types` (Task 1).
- Produces: `ParsedTask = { kind: TaskKind; owner: string; repo: string; number: number }`, `ParseTaskResult`, and `parseTaskUrl(input: string): ParseTaskResult` — used by Task 9 (`useTasks`), Task 12 (`AddTaskDialog`), and Task 14 (`App.tsx`'s drop/paste handling).

- [ ] **Step 1: Write the failing tests**

Create `src/github/parseTaskUrl.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseTaskUrl } from './parseTaskUrl';

describe('parseTaskUrl — pull requests', () => {
  it('accepts a full PR URL', () => {
    const result = parseTaskUrl('https://github.com/Example/example-server/pull/4821');
    expect(result).toEqual({
      ok: true,
      value: { kind: 'pr', owner: 'Example', repo: 'example-server', number: 4821 },
    });
  });

  it('accepts a PR URL with trailing segments', () => {
    const result = parseTaskUrl('https://github.com/Example/example-server/pull/4821/files');
    expect(result.ok).toBe(true);
  });
});

describe('parseTaskUrl — issues', () => {
  it('accepts a full issue URL', () => {
    const result = parseTaskUrl('https://github.com/Example/example-server/issues/55');
    expect(result).toEqual({
      ok: true,
      value: { kind: 'issue', owner: 'Example', repo: 'example-server', number: 55 },
    });
  });
});

describe('parseTaskUrl — shorthand is rejected', () => {
  it('rejects owner/repo#number with a message naming the reason', () => {
    const result = parseTaskUrl('Example/example-server#55');
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toMatch(/full github link/i);
    expect(result.error).toMatch(/issue or a pull request/i);
  });
});

describe('parseTaskUrl — invalid input', () => {
  it('rejects an empty string', () => {
    expect(parseTaskUrl('').ok).toBe(false);
    expect(parseTaskUrl('   ').ok).toBe(false);
  });

  it('rejects a non-URL string', () => {
    expect(parseTaskUrl('not a url').ok).toBe(false);
  });

  it('rejects a non-github URL', () => {
    const result = parseTaskUrl('https://gitlab.com/a/b/issues/1');
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('github.com');
  });

  it('rejects a bare repository URL', () => {
    const result = parseTaskUrl('https://github.com/Example/example-server');
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toMatch(/repository/i);
  });

  it('rejects a URL pointing at neither pull nor issues', () => {
    const result = parseTaskUrl('https://github.com/Example/example-server/tree/main');
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('tree');
  });

  it('rejects a missing or non-numeric number', () => {
    expect(parseTaskUrl('https://github.com/Example/example-server/pull/').ok).toBe(false);
    expect(parseTaskUrl('https://github.com/Example/example-server/pull/abc').ok).toBe(false);
    expect(parseTaskUrl('https://github.com/Example/example-server/issues/0').ok).toBe(false);
  });

  it('accepts www.github.com', () => {
    const result = parseTaskUrl('https://www.github.com/Example/example-server/pull/1');
    expect(result.ok).toBe(true);
  });

  it('rejects a non-http(s) protocol', () => {
    const result = parseTaskUrl('ftp://github.com/Example/example-server/pull/1');
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toMatch(/http/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/github/parseTaskUrl.test.ts`
Expected: FAIL with "Cannot find module './parseTaskUrl'".

- [ ] **Step 3: Write the implementation**

Create `src/github/parseTaskUrl.ts`:

```ts
import type { TaskKind } from '../types';

export type ParsedTask = { kind: TaskKind; owner: string; repo: string; number: number };

export type ParseTaskResult = { ok: true; value: ParsedTask } | { ok: false; error: string };

function fail(error: string): ParseTaskResult {
  return { ok: false, error };
}

function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return value > 0 ? value : null;
}

/**
 * Accepts a full GitHub issue or pull request URL. No `owner/repo#number`
 * shorthand: issues and PRs share one number sequence per repo, so the
 * shorthand can't say which type it names without an extra request to
 * GitHub — see spec §7. `parsePrUrl` (used by the Pull Requests and
 * Backports tabs, where every target is necessarily a PR) is unaffected.
 */
export function parseTaskUrl(input: string): ParseTaskResult {
  const trimmed = input.trim();
  if (trimmed === '') return fail('Enter an issue or pull request URL — the input is empty.');

  if (/^[^/\s]+\/[^/\s]+#\d+$/.test(trimmed)) {
    return fail(
      'Tasks needs the full GitHub link — owner/repo#N could be either an issue or a pull request.',
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return fail('That is not a GitHub issue or pull request URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return fail('Only http and https URLs are supported.');
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    return fail(`Only github.com URLs are supported, not ${url.hostname}.`);
  }

  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const [owner, repo, kind, rawNumber] = segments;

  if (owner === undefined || repo === undefined) {
    return fail('That URL does not point at an issue or a pull request.');
  }
  if (kind === undefined) {
    return fail('That URL points at a repository, not an issue or a pull request.');
  }
  if (kind !== 'pull' && kind !== 'issues') {
    return fail(`That URL points at "${kind}", not an issue or a pull request.`);
  }

  const number = parseNumber(rawNumber);
  if (number === null) {
    return fail('That number is missing or not a positive whole number.');
  }

  return { ok: true, value: { kind: kind === 'pull' ? 'pr' : 'issue', owner, repo, number } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/github/parseTaskUrl.test.ts`
Expected: PASS.

- [ ] **Step 5: Bump the version and commit**

```bash
git add src/github/parseTaskUrl.ts src/github/parseTaskUrl.test.ts package.json
git commit -m "feat: add parseTaskUrl, full-URL-only issue/PR parsing"
```

---

### Task 8: Task storage

**Files:**
- Create: `src/storage/tasks.ts`
- Test: `src/storage/tasks.test.ts`

**Interfaces:**
- Consumes: `TrackedTask`, `TaskKind` from `../types` (Task 1); `readKey`/`writeKey` from `./localStorage` (existing, unchanged).
- Produces: `TASKS_KEY`, `CORRUPT_TASKS_KEY`, `isTrackedTask`, `loadTasks(storage?): LoadTasksResult`, `saveTasks(tasks, storage?): void` — used by Task 9 (`useTasks`).

- [ ] **Step 1: Write the failing tests**

Create `src/storage/tasks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CORRUPT_TASKS_KEY, TASKS_KEY, isTrackedTask, loadTasks, saveTasks } from './tasks';

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

describe('isTrackedTask', () => {
  it('accepts a well-formed task of either kind', () => {
    expect(
      isTrackedTask({ kind: 'pr', owner: 'a', repo: 'b', number: 1, addedAt: '2026-08-27T09:00:00Z' }),
    ).toBe(true);
    expect(
      isTrackedTask({
        kind: 'issue',
        owner: 'a',
        repo: 'b',
        number: 1,
        addedAt: '2026-08-27T09:00:00Z',
      }),
    ).toBe(true);
  });

  it('rejects a value with an unrecognised kind', () => {
    expect(
      isTrackedTask({
        kind: 'discussion',
        owner: 'a',
        repo: 'b',
        number: 1,
        addedAt: '2026-08-27T09:00:00Z',
      }),
    ).toBe(false);
  });

  it('rejects a non-positive or non-integer number', () => {
    expect(
      isTrackedTask({ kind: 'pr', owner: 'a', repo: 'b', number: 0, addedAt: '2026-08-27T09:00:00Z' }),
    ).toBe(false);
    expect(
      isTrackedTask({
        kind: 'pr',
        owner: 'a',
        repo: 'b',
        number: 1.5,
        addedAt: '2026-08-27T09:00:00Z',
      }),
    ).toBe(false);
  });

  it('rejects a missing field', () => {
    expect(isTrackedTask({ kind: 'pr', owner: 'a', repo: 'b', number: 1 })).toBe(false);
  });
});

describe('loadTasks', () => {
  it('returns an empty list when nothing is stored', () => {
    expect(loadTasks(fakeStorage())).toEqual({ tasks: [], error: null });
  });

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

  it('backs up and resets on unreadable JSON', () => {
    const storage = fakeStorage({ [TASKS_KEY]: 'not json' });
    const result = loadTasks(storage);
    expect(result.tasks).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(storage.getItem(CORRUPT_TASKS_KEY)).toBe('not json');
  });

  it('backs up and resets on a wrong envelope shape', () => {
    const storage = fakeStorage({ [TASKS_KEY]: JSON.stringify({ tasks: [] }) });
    const result = loadTasks(storage);
    expect(result.tasks).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(storage.getItem(CORRUPT_TASKS_KEY)).toBeTruthy();
  });

  it('backs up and resets on an unsupported version', () => {
    const storage = fakeStorage({ [TASKS_KEY]: JSON.stringify({ version: 99, tasks: [] }) });
    const result = loadTasks(storage);
    expect(result.tasks).toEqual([]);
    expect(result.error).toMatch(/unsupported version/);
  });

  it('backs up and resets when an entry in the array is malformed', () => {
    const storage = fakeStorage({
      [TASKS_KEY]: JSON.stringify({ version: 1, tasks: [{ kind: 'pr', owner: 'a' }] }),
    });
    const result = loadTasks(storage);
    expect(result.tasks).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});

describe('saveTasks', () => {
  it('round-trips through loadTasks', () => {
    const storage = fakeStorage();
    saveTasks(
      [{ kind: 'issue', owner: 'a', repo: 'b', number: 2, addedAt: '2026-08-27T09:00:00Z' }],
      storage,
    );
    expect(loadTasks(storage)).toEqual({
      tasks: [{ kind: 'issue', owner: 'a', repo: 'b', number: 2, addedAt: '2026-08-27T09:00:00Z' }],
      error: null,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/storage/tasks.test.ts`
Expected: FAIL with "Cannot find module './tasks'".

- [ ] **Step 3: Write the implementation**

Create `src/storage/tasks.ts`:

```ts
import type { TaskKind, TrackedTask } from '../types';
import { readKey, writeKey } from './localStorage';

export const TASKS_KEY = 'hubdash.tasks';
export const CORRUPT_TASKS_KEY = 'hubdash.tasks.corrupt';

const VERSION = 1;

export type LoadTasksResult = { tasks: TrackedTask[]; error: string | null };

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

function reject(storage: Storage | null | undefined, raw: string, error: string): LoadTasksResult {
  // Keep the unusable value so a later save cannot destroy the user's list.
  writeKey(storage, CORRUPT_TASKS_KEY, raw);
  return { tasks: [], error };
}

export function loadTasks(storage?: Storage | null): LoadTasksResult {
  const raw = readKey(storage, TASKS_KEY);
  if (raw === null) return { tasks: [], error: null };

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
  if (envelope.version !== VERSION) {
    return reject(storage, raw, 'Your tasks use an unsupported version and were reset.');
  }
  if (!Array.isArray(envelope.tasks) || !envelope.tasks.every(isTrackedTask)) {
    return reject(storage, raw, UNREADABLE);
  }

  return { tasks: envelope.tasks, error: null };
}

export function saveTasks(tasks: TrackedTask[], storage?: Storage | null): void {
  writeKey(storage, TASKS_KEY, JSON.stringify({ version: VERSION, tasks }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/storage/tasks.test.ts`
Expected: PASS.

- [ ] **Step 5: Bump the version and commit**

```bash
git add src/storage/tasks.ts src/storage/tasks.test.ts package.json
git commit -m "feat: add task storage under hubdash.tasks"
```

---

### Task 9: `useTasks` hook

**Files:**
- Create: `src/hooks/useTasks.ts`
- Test: `src/hooks/useTasks.test.ts`

**Interfaces:**
- Consumes: `prKey` from `../domain/prKey` (existing), `ParsedTask` from `../github/parseTaskUrl` (Task 7), `loadTasks`/`saveTasks` from `../storage/tasks` (Task 8), `TrackedTask`/`PrKey` from `../types` (Task 1).
- Produces: `UseTasksResult = { tasks, addTask, removeTask, reorderTasks, storageError, dismissStorageError }` — used by Task 14 (`App.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useTasks.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CORRUPT_TASKS_KEY, TASKS_KEY } from '../storage/tasks';
import { useTasks } from './useTasks';

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

const clock = () => '2026-08-27T09:00:00Z';

describe('useTasks — add and remove', () => {
  it('starts empty with no stored tasks', () => {
    const { result } = renderHook(() => useTasks({ storage: fakeStorage(), clock }));
    expect(result.current.tasks).toEqual([]);
    expect(result.current.storageError).toBeNull();
  });

  it('adds a task and persists it', () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => useTasks({ storage, clock }));

    act(() => {
      result.current.addTask({ kind: 'pr', owner: 'Example', repo: 'example-server', number: 4821 });
    });

    expect(result.current.tasks).toEqual([
      { kind: 'pr', owner: 'Example', repo: 'example-server', number: 4821, addedAt: clock() },
    ]);
    expect(JSON.parse(storage.getItem(TASKS_KEY) ?? '')).toEqual({
      version: 1,
      tasks: result.current.tasks,
    });
  });

  it('reports a duplicate add without adding a second entry', () => {
    const { result } = renderHook(() => useTasks({ storage: fakeStorage(), clock }));
    const parsed = { kind: 'pr' as const, owner: 'Example', repo: 'example-server', number: 4821 };

    act(() => {
      result.current.addTask(parsed);
    });
    let outcome: { added: boolean } = { added: true };
    act(() => {
      outcome = result.current.addTask(parsed);
    });

    expect(outcome.added).toBe(false);
    expect(result.current.tasks).toHaveLength(1);
  });

  it('removes a task by key', () => {
    const { result } = renderHook(() => useTasks({ storage: fakeStorage(), clock }));
    act(() => {
      result.current.addTask({ kind: 'pr', owner: 'Example', repo: 'example-server', number: 4821 });
    });
    act(() => {
      result.current.removeTask('example/example-server#4821');
    });
    expect(result.current.tasks).toEqual([]);
  });
});

describe('useTasks — reorder', () => {
  function seeded(storage: Storage) {
    const { result } = renderHook(() => useTasks({ storage, clock }));
    act(() => {
      result.current.addTask({ kind: 'pr', owner: 'a', repo: 'a', number: 1 });
      result.current.addTask({ kind: 'pr', owner: 'a', repo: 'a', number: 2 });
      result.current.addTask({ kind: 'pr', owner: 'a', repo: 'a', number: 3 });
    });
    return result;
  }

  it('moves an item to a later index', () => {
    const result = seeded(fakeStorage());
    act(() => {
      result.current.reorderTasks(0, 2);
    });
    expect(result.current.tasks.map((task) => task.number)).toEqual([2, 3, 1]);
  });

  it('moves an item to an earlier index', () => {
    const result = seeded(fakeStorage());
    act(() => {
      result.current.reorderTasks(2, 0);
    });
    expect(result.current.tasks.map((task) => task.number)).toEqual([3, 1, 2]);
  });

  it('does nothing when the index is unchanged or out of range', () => {
    const result = seeded(fakeStorage());
    const before = result.current.tasks;
    act(() => {
      result.current.reorderTasks(1, 1);
      result.current.reorderTasks(-1, 0);
      result.current.reorderTasks(0, 5);
    });
    expect(result.current.tasks).toEqual(before);
  });

  it('persists the new order', () => {
    const storage = fakeStorage();
    const result = seeded(storage);
    act(() => {
      result.current.reorderTasks(0, 2);
    });
    const stored = JSON.parse(storage.getItem(TASKS_KEY) ?? '');
    expect(stored.tasks.map((task: { number: number }) => task.number)).toEqual([2, 3, 1]);
  });
});

describe('useTasks — corrupt storage', () => {
  it('surfaces the load error and does not overwrite the corrupt backup on mount', () => {
    const storage = fakeStorage({ [TASKS_KEY]: 'not json' });
    const { result } = renderHook(() => useTasks({ storage, clock }));
    expect(result.current.tasks).toEqual([]);
    expect(result.current.storageError).toBeTruthy();
    expect(storage.getItem(CORRUPT_TASKS_KEY)).toBe('not json');
  });

  it('dismisses the storage error', () => {
    const storage = fakeStorage({ [TASKS_KEY]: 'not json' });
    const { result } = renderHook(() => useTasks({ storage, clock }));
    act(() => {
      result.current.dismissStorageError();
    });
    expect(result.current.storageError).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useTasks.test.ts`
Expected: FAIL with "Cannot find module './useTasks'".

- [ ] **Step 3: Write the implementation**

Create `src/hooks/useTasks.ts`:

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
  addTask: (parsed: ParsedTask) => { added: boolean; key: PrKey };
  removeTask: (key: PrKey) => void;
  reorderTasks: (fromIndex: number, toIndex: number) => void;
  storageError: string | null;
  dismissStorageError: () => void;
};

function keyOf(task: TrackedTask | ParsedTask): PrKey {
  return prKey(task.owner, task.repo, task.number);
}

/**
 * Owns the task list. Writes are explicit — every mutation saves — and the
 * hook never saves on mount, so an unreadable stored value is not
 * overwritten before the user has had a chance to see the warning about it.
 * Same discipline as useTrackedPrs and useBackportGroups.
 */
export function useTasks(options: UseTasksOptions = {}): UseTasksResult {
  const { storage, clock } = options;
  const now = clock ?? defaultClock;

  const initial = useRef<{ tasks: TrackedTask[]; error: string | null } | null>(null);
  if (initial.current === null) {
    initial.current = loadTasks(storage);
  }

  const [tasks, setTasks] = useState<TrackedTask[]>(initial.current.tasks);
  const [storageError, setStorageError] = useState<string | null>(initial.current.error);

  // Mirrors `tasks` so mutations can decide synchronously and return a
  // verdict — the dialog needs this to flash a duplicate.
  const tasksRef = useRef<TrackedTask[]>(initial.current.tasks);

  const commit = useCallback(
    (next: TrackedTask[]) => {
      tasksRef.current = next;
      saveTasks(next, storage);
      setTasks(next);
    },
    [storage],
  );

  const addTask = useCallback(
    (parsed: ParsedTask) => {
      const key = keyOf(parsed);
      if (tasksRef.current.some((task) => keyOf(task) === key)) {
        return { added: false, key };
      }
      commit([...tasksRef.current, { ...parsed, addedAt: now() }]);
      return { added: true, key };
    },
    [commit, now],
  );

  const removeTask = useCallback(
    (key: PrKey) => {
      const next = tasksRef.current.filter((task) => keyOf(task) !== key);
      if (next.length === tasksRef.current.length) return;
      commit(next);
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
      commit(next);
    },
    [commit],
  );

  const dismissStorageError = useCallback(() => setStorageError(null), []);

  return { tasks, addTask, removeTask, reorderTasks, storageError, dismissStorageError };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useTasks.test.ts`
Expected: PASS.

- [ ] **Step 5: Bump the version and commit**

```bash
git add src/hooks/useTasks.ts src/hooks/useTasks.test.ts package.json
git commit -m "feat: add useTasks hook — add/remove/reorder over hubdash.tasks"
```

---

### Task 10: `TaskRow`

**Files:**
- Create: `src/ui/TaskRow.tsx`
- Test: `src/ui/TaskRow.test.tsx`

**Interfaces:**
- Consumes: `taskStatusFor` from `../domain/taskStatus` (Task 6); `IssueEntry`/`PrEntry`/`TrackedTask` from `../types` (Task 1); `tokens` from `./theme` (existing).
- Produces: `TaskRow` component with props `{ task: TrackedTask; entry: PrEntry | IssueEntry | undefined; flashed: boolean; onRemove: () => void; onDragStart: () => void; onDragOver: () => void; onDrop: () => void }` — used by Task 11 (`TasksTab`).

- [ ] **Step 1: Write the failing tests**

Create `src/ui/TaskRow.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makePr } from '../test/makePr';
import type { IssueEntry, NormalisedIssue, PrEntry, TrackedTask } from '../types';
import { TaskRow } from './TaskRow';

const prTask: TrackedTask = {
  kind: 'pr',
  owner: 'Example',
  repo: 'example-server',
  number: 4821,
  addedAt: '2026-08-27T09:00:00Z',
};

function issueOf(overrides: Partial<NormalisedIssue> = {}): NormalisedIssue {
  return {
    key: 'example/example-server#55',
    owner: 'Example',
    repo: 'example-server',
    number: 55,
    title: 'Sort order is wrong on empty input',
    url: 'https://github.com/Example/example-server/issues/55',
    author: 'octocat',
    nameWithOwner: 'Example/example-server',
    updatedAt: '2026-08-27T10:00:00Z',
    lifecycle: 'OPEN',
    ...overrides,
  };
}

const noop = () => {};

describe('TaskRow — pending and errored', () => {
  it('shows a pending placeholder when no entry has resolved yet', () => {
    render(
      <TaskRow
        task={prTask}
        entry={undefined}
        flashed={false}
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
    expect(screen.getByText('#4821')).toBeInTheDocument();
  });

  it('shows the transport error message for an errored entry', () => {
    const entry: PrEntry = {
      status: 'error',
      key: 'example/example-server#4821',
      tracked: prTask,
      message: 'This pull request could not be loaded.',
    };
    render(
      <TaskRow
        task={prTask}
        entry={entry}
        flashed={false}
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByText('This pull request could not be loaded.')).toBeInTheDocument();
  });
});

describe('TaskRow — a PR task', () => {
  function okEntry(overrides: Parameters<typeof makePr>[0] = {}): PrEntry {
    const pr = makePr({ number: 4821, ...overrides });
    return { status: 'ok', key: pr.key, tracked: prTask, pr };
  }

  it('shows the title, link, and a ready badge', () => {
    render(
      <TaskRow
        task={prTask}
        entry={okEntry({ reviewDecision: 'APPROVED', ci: 'success' })}
        flashed={false}
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByText('Fix index rotation')).toBeInTheDocument();
    expect(screen.getByText(/ready/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#4821' })).toHaveAttribute(
      'href',
      'https://github.com/Example/example-server/pull/4821',
    );
  });

  it('shows a needs action badge for changes requested', () => {
    render(
      <TaskRow
        task={prTask}
        entry={okEntry({ reviewDecision: 'CHANGES_REQUESTED', requestedReviewerCount: 0 })}
        flashed={false}
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByText(/needs action/i)).toBeInTheDocument();
  });

  it('shows a merged badge', () => {
    render(
      <TaskRow
        task={prTask}
        entry={okEntry({ lifecycle: 'MERGED' })}
        flashed={false}
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByText(/merged/i)).toBeInTheDocument();
  });
});

describe('TaskRow — an issue task', () => {
  const issueTask: TrackedTask = {
    kind: 'issue',
    owner: 'Example',
    repo: 'example-server',
    number: 55,
    addedAt: '2026-08-27T09:00:00Z',
  };

  it('shows the issue title and a waiting badge when open', () => {
    const entry: IssueEntry = { status: 'ok', key: issueOf().key, tracked: issueTask, issue: issueOf() };
    render(
      <TaskRow
        task={issueTask}
        entry={entry}
        flashed={false}
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByText('Sort order is wrong on empty input')).toBeInTheDocument();
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#55' })).toHaveAttribute(
      'href',
      'https://github.com/Example/example-server/issues/55',
    );
  });

  it('shows a closed badge when the issue is closed', () => {
    const entry: IssueEntry = {
      status: 'ok',
      key: issueOf().key,
      tracked: issueTask,
      issue: issueOf({ lifecycle: 'CLOSED' }),
    };
    render(
      <TaskRow
        task={issueTask}
        entry={entry}
        flashed={false}
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByText(/closed/i)).toBeInTheDocument();
  });
});

describe('TaskRow — remove and flash', () => {
  it('calls onRemove when the remove button is clicked', async () => {
    const onRemove = vi.fn();
    render(
      <TaskRow
        task={prTask}
        entry={undefined}
        flashed={false}
        onRemove={onRemove}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /remove #4821/i }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('marks itself flashed via data-flashed', () => {
    render(
      <TaskRow
        task={prTask}
        entry={undefined}
        flashed
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    expect(screen.getByTestId('task-row')).toHaveAttribute('data-flashed', 'true');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/TaskRow.test.tsx`
Expected: FAIL with "Cannot find module './TaskRow'".

- [ ] **Step 3: Write the implementation**

Create `src/ui/TaskRow.tsx`:

```tsx
import { useState } from 'react';
import styled from 'styled-components';
import { taskStatusFor } from '../domain/taskStatus';
import type { IssueEntry, PrEntry, TrackedTask } from '../types';
import { tokens } from './theme';

export type TaskRowProps = {
  task: TrackedTask;
  entry: PrEntry | IssueEntry | undefined;
  flashed: boolean;
  onRemove: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
};

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: ${tokens.space(3)};
  padding: ${tokens.space(2)} ${tokens.space(3)};
  background: ${tokens.color.surface};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  font-family: ${tokens.font.body};
  color: ${tokens.color.text};

  &[data-flashed='true'] {
    outline: 2px solid ${tokens.color.accent};
  }

  &[data-dragging='true'] {
    opacity: 0.4;
  }
`;

const Handle = styled.span`
  cursor: grab;
  color: ${tokens.color.textMuted};
  flex-shrink: 0;
`;

const NumberLink = styled.a`
  font-family: ${tokens.font.mono};
  color: ${tokens.color.accent};
  text-decoration: none;
  flex-shrink: 0;

  &:hover {
    text-decoration: underline;
  }
`;

const Title = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Meta = styled.span`
  font-size: 12px;
  color: ${tokens.color.textMuted};
  flex-shrink: 0;
`;

const Status = styled.span<{ $tone: string }>`
  font-size: 13px;
  color: ${(props) => props.$tone};
  flex-shrink: 0;
`;

const RemoveButton = styled.button`
  background: none;
  border: none;
  color: ${tokens.color.textMuted};
  cursor: pointer;
  font-size: 14px;
  flex-shrink: 0;

  &:hover {
    color: ${tokens.color.bad};
  }
`;

function statusView(entry: PrEntry | IssueEntry | undefined): { label: string; tone: string } {
  const status = taskStatusFor(entry);
  switch (status.kind) {
    case 'pending':
      return { label: '… pending', tone: tokens.color.textMuted };
    case 'errored':
      return { label: status.message, tone: tokens.color.bad };
    case 'waiting':
      return { label: '◌ waiting', tone: tokens.color.textMuted };
    case 'needsAction':
      return { label: '⚠ needs action', tone: tokens.color.bad };
    case 'ready':
      return { label: '✓ ready', tone: tokens.color.good };
    case 'merged':
      return { label: '✓ merged', tone: tokens.color.good };
    case 'closed':
      return { label: '✖ closed', tone: tokens.color.bad };
  }
}

function titleOf(task: TrackedTask, entry: PrEntry | IssueEntry | undefined): string {
  if (entry?.status !== 'ok') return `#${task.number}`;
  return 'pr' in entry ? entry.pr.title : entry.issue.title;
}

function urlOf(task: TrackedTask, entry: PrEntry | IssueEntry | undefined): string {
  if (entry?.status === 'ok') return 'pr' in entry ? entry.pr.url : entry.issue.url;
  const segment = task.kind === 'issue' ? 'issues' : 'pull';
  return `https://github.com/${task.owner}/${task.repo}/${segment}/${task.number}`;
}

function nameWithOwnerOf(task: TrackedTask, entry: PrEntry | IssueEntry | undefined): string {
  if (entry?.status === 'ok') return 'pr' in entry ? entry.pr.nameWithOwner : entry.issue.nameWithOwner;
  return `${task.owner}/${task.repo}`;
}

export function TaskRow({ task, entry, flashed, onRemove, onDragStart, onDragOver, onDrop }: TaskRowProps) {
  const [dragging, setDragging] = useState(false);
  const status = statusView(entry);

  return (
    <Row
      data-testid="task-row"
      data-flashed={flashed ? 'true' : 'false'}
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
      <Title>{titleOf(task, entry)}</Title>
      <Meta>{nameWithOwnerOf(task, entry)}</Meta>
      <Status $tone={status.tone}>{status.label}</Status>
      <RemoveButton type="button" aria-label={`Remove #${task.number} from tasks`} onClick={onRemove}>
        ✕
      </RemoveButton>
    </Row>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/TaskRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Bump the version and commit**

```bash
git add src/ui/TaskRow.tsx src/ui/TaskRow.test.tsx package.json
git commit -m "feat: add TaskRow — title, status badge, remove, drag handle"
```

---

### Task 11: `TasksTab`

**Files:**
- Create: `src/ui/TasksTab.tsx`
- Test: `src/ui/TasksTab.test.tsx`

**Interfaces:**
- Consumes: `TaskRow` (Task 10); `prKey` from `../domain/prKey` (existing); `Empty` from `./Empty` (existing); `IssueEntry`/`PrEntry`/`PrKey`/`TrackedTask` from `../types` (Task 1).
- Produces: `TasksTab` component with props `{ tasks: TrackedTask[]; entries: Map<PrKey, PrEntry | IssueEntry>; flashedKey: PrKey | null; onRemoveTask: (key: PrKey) => void; onReorder: (fromIndex: number, toIndex: number) => void }` — used by Task 14 (`App.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `src/ui/TasksTab.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IssueEntry, PrEntry, PrKey, TrackedTask } from '../types';
import { TasksTab } from './TasksTab';

function task(number: number): TrackedTask {
  return { kind: 'pr', owner: 'a', repo: 'a', number, addedAt: '2026-08-27T09:00:00Z' };
}

describe('TasksTab — empty state', () => {
  it('shows the empty prompt when there are no tasks', () => {
    render(
      <TasksTab
        tasks={[]}
        entries={new Map()}
        flashedKey={null}
        onRemoveTask={() => {}}
        onReorder={() => {}}
      />,
    );
    expect(screen.getByText(/use the button, paste a url, or drop a link here/i)).toBeInTheDocument();
  });
});

describe('TasksTab — rendering', () => {
  it('renders one row per task, in stored order', () => {
    render(
      <TasksTab
        tasks={[task(1), task(2), task(3)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={() => {}}
        onReorder={() => {}}
      />,
    );
    const rows = screen.getAllByTestId('task-row');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('#1'),
      expect.stringContaining('#2'),
      expect.stringContaining('#3'),
    ]);
  });

  it('calls onRemoveTask with the right key', async () => {
    const onRemoveTask = vi.fn();
    render(
      <TasksTab
        tasks={[task(1)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={onRemoveTask}
        onReorder={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove #1/i }));
    expect(onRemoveTask).toHaveBeenCalledWith('a/a#1');
  });
});

describe('TasksTab — reordering', () => {
  it('calls onReorder with the source and target index on drop', () => {
    render(
      <TasksTab
        tasks={[task(1), task(2), task(3)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={() => {}}
        onReorder={(from, to) => {
          expect(from).toBe(0);
          expect(to).toBe(2);
        }}
      />,
    );
    const rows = screen.getAllByTestId('task-row');
    const first = rows[0];
    const third = rows[2];
    if (!first || !third) throw new Error('expected three rows');
    fireEvent.dragStart(first);
    fireEvent.dragOver(third);
    fireEvent.drop(third);
  });

  it('does not call onReorder when dropped on the same row it started from', () => {
    const onReorder = vi.fn();
    render(
      <TasksTab
        tasks={[task(1), task(2)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={() => {}}
        onReorder={onReorder}
      />,
    );
    const rows = screen.getAllByTestId('task-row');
    const first = rows[0];
    if (!first) throw new Error('expected a row');
    fireEvent.dragStart(first);
    fireEvent.drop(first);
    expect(onReorder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/TasksTab.test.tsx`
Expected: FAIL with "Cannot find module './TasksTab'".

- [ ] **Step 3: Write the implementation**

Create `src/ui/TasksTab.tsx`:

```tsx
import { useRef } from 'react';
import styled from 'styled-components';
import { prKey } from '../domain/prKey';
import type { IssueEntry, PrEntry, PrKey, TrackedTask } from '../types';
import { Empty } from './Empty';
import { TaskRow } from './TaskRow';
import { tokens } from './theme';

export type TasksTabProps = {
  tasks: TrackedTask[];
  entries: Map<PrKey, PrEntry | IssueEntry>;
  flashedKey: PrKey | null;
  onRemoveTask: (key: PrKey) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
};

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${tokens.space(2)};
  padding: ${tokens.space(5)};
`;

export function TasksTab({ tasks, entries, flashedKey, onRemoveTask, onReorder }: TasksTabProps) {
  // A ref, not state: the dragged index is read only inside the drop
  // handler it triggers synchronously, and does not need to drive a render.
  const dragIndex = useRef<number | null>(null);

  if (tasks.length === 0) {
    return (
      <Empty>Add an issue or pull request — use the button, paste a URL, or drop a link here.</Empty>
    );
  }

  return (
    <List>
      {tasks.map((task, index) => {
        const key = prKey(task.owner, task.repo, task.number);
        return (
          <TaskRow
            key={key}
            task={task}
            entry={entries.get(key)}
            flashed={key === flashedKey}
            onRemove={() => onRemoveTask(key)}
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
    </List>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/TasksTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Bump the version and commit**

```bash
git add src/ui/TasksTab.tsx src/ui/TasksTab.test.tsx package.json
git commit -m "feat: add TasksTab — the flat, manually reordered task list"
```

---

### Task 12: `AddTaskDialog`

**Files:**
- Create: `src/ui/AddTaskDialog.tsx`
- Test: `src/ui/AddTaskDialog.test.tsx`

**Interfaces:**
- Consumes: `parseTaskUrl`, `ParsedTask` from `../github/parseTaskUrl` (Task 7); `PrKey` from `../types` (existing); `tokens` from `./theme` (existing).
- Produces: `AddTaskDialog` component with props `{ open: boolean; onClose: () => void; onAdd: (parsed: ParsedTask) => { added: boolean; key: PrKey } }` — used by Task 14 (`App.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `src/ui/AddTaskDialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddTaskDialog } from './AddTaskDialog';

function setup(onAdd = vi.fn().mockReturnValue({ added: true, key: 'k' })) {
  const onClose = vi.fn();
  render(<AddTaskDialog open onClose={onClose} onAdd={onAdd} />);
  return { onAdd, onClose };
}

describe('AddTaskDialog', () => {
  it('renders nothing when closed', () => {
    render(<AddTaskDialog open={false} onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('adds a valid PR URL and closes', async () => {
    const { onAdd, onClose } = setup();
    await userEvent.type(
      screen.getByLabelText(/issue or pull request url/i),
      'https://github.com/Example/example-server/pull/4821',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(onAdd).toHaveBeenCalledWith({
      kind: 'pr',
      owner: 'Example',
      repo: 'example-server',
      number: 4821,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('adds a valid issue URL and closes', async () => {
    const { onAdd, onClose } = setup();
    await userEvent.type(
      screen.getByLabelText(/issue or pull request url/i),
      'https://github.com/Example/example-server/issues/55',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(onAdd).toHaveBeenCalledWith({
      kind: 'issue',
      owner: 'Example',
      repo: 'example-server',
      number: 55,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the parser error and does not add, for the owner/repo#N shorthand', async () => {
    const { onAdd, onClose } = setup();
    await userEvent.type(screen.getByLabelText(/issue or pull request url/i), 'Example/example-server#4821');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/full github link/i);
    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('tells nothing extra and still closes when the item is already tracked', async () => {
    const onAdd = vi.fn().mockReturnValue({ added: false, key: 'k' });
    const { onClose } = setup(onAdd);
    await userEvent.type(
      screen.getByLabelText(/issue or pull request url/i),
      'https://github.com/Example/example-server/pull/4821',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape and on Cancel', async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('resets the field when reopened', async () => {
    const { rerender } = render(
      <AddTaskDialog open onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />,
    );
    await userEvent.type(
      screen.getByLabelText(/issue or pull request url/i),
      'https://github.com/Example/example-server/pull/1',
    );
    rerender(<AddTaskDialog open={false} onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />);
    rerender(<AddTaskDialog open onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />);
    expect(screen.getByLabelText(/issue or pull request url/i)).toHaveValue('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/AddTaskDialog.test.tsx`
Expected: FAIL with "Cannot find module './AddTaskDialog'".

- [ ] **Step 3: Write the implementation**

Create `src/ui/AddTaskDialog.tsx`:

```tsx
import { useEffect, useId, useState } from 'react';
import styled from 'styled-components';
import type { ParsedTask } from '../github/parseTaskUrl';
import { parseTaskUrl } from '../github/parseTaskUrl';
import type { PrKey } from '../types';
import { tokens } from './theme';

export type AddTaskDialogProps = {
  open: boolean;
  onClose: () => void;
  onAdd: (parsed: ParsedTask) => { added: boolean; key: PrKey };
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

export function AddTaskDialog({ open, onClose, onAdd }: AddTaskDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    if (!open) {
      setValue('');
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
    const parsed = parseTaskUrl(value);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    // A duplicate is not an error: App flashes the existing row instead.
    onAdd(parsed.value);
    onClose();
  };

  return (
    <Backdrop onClick={onClose}>
      <Panel
        role="dialog"
        aria-modal="true"
        aria-label="Add a task"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <Label htmlFor={inputId}>Issue or pull request URL</Label>
        <Input
          id={inputId}
          autoFocus
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          placeholder="https://github.com/owner/repo/pull/123"
        />
        <Hint>You can also paste anywhere on this tab, or drag a link onto the window.</Hint>
        {error === null ? null : <Error role="alert">{error}</Error>}
        <Actions>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Add</Button>
        </Actions>
      </Panel>
    </Backdrop>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/AddTaskDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Bump the version and commit**

```bash
git add src/ui/AddTaskDialog.tsx src/ui/AddTaskDialog.test.tsx package.json
git commit -m "feat: add AddTaskDialog — full-URL-only issue/PR entry"
```

---

### Task 13: `TabBar` gains a third tab

**Files:**
- Modify: `src/ui/TabBar.tsx`
- Modify: `src/ui/TabBar.test.tsx`

**Interfaces:**
- Produces: `TabId = 'board' | 'backports' | 'tasks'`, `TabBarProps` gains `tasksCount: number` — used by Task 14 (`App.tsx`).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/ui/TabBar.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TabBar } from './TabBar';

describe('TabBar', () => {
  it('shows all three tabs with their counts', () => {
    render(
      <TabBar
        active="board"
        onChange={() => {}}
        boardCount={3}
        backportsCount={2}
        tasksCount={5}
      />,
    );
    expect(screen.getByRole('tab', { name: /pull requests/i })).toHaveTextContent('3');
    expect(screen.getByRole('tab', { name: /backports/i })).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /^tasks/i })).toHaveTextContent('5');
  });

  it('marks the active tab selected', () => {
    render(
      <TabBar
        active="tasks"
        onChange={() => {}}
        boardCount={0}
        backportsCount={0}
        tasksCount={0}
      />,
    );
    expect(screen.getByRole('tab', { name: /^tasks/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /pull requests/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('tab', { name: /backports/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('calls onChange with the clicked tab', async () => {
    const onChange = vi.fn();
    render(
      <TabBar
        active="board"
        onChange={onChange}
        boardCount={0}
        backportsCount={0}
        tasksCount={0}
      />,
    );
    await userEvent.click(screen.getByRole('tab', { name: /backports/i }));
    expect(onChange).toHaveBeenCalledWith('backports');
    await userEvent.click(screen.getByRole('tab', { name: /^tasks/i }));
    expect(onChange).toHaveBeenCalledWith('tasks');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/TabBar.test.tsx`
Expected: FAIL — `tasksCount` is not a valid prop yet, and there's no third tab.

- [ ] **Step 3: Update `TabBar.tsx`**

Replace the full contents of `src/ui/TabBar.tsx` with:

```tsx
import styled from 'styled-components';
import { tokens } from './theme';

export type TabId = 'board' | 'backports' | 'tasks';

export type TabBarProps = {
  active: TabId;
  onChange: (tab: TabId) => void;
  boardCount: number;
  backportsCount: number;
  tasksCount: number;
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

export function TabBar({ active, onChange, boardCount, backportsCount, tasksCount }: TabBarProps) {
  return (
    <Bar role="tablist">
      <Tab role="tab" aria-selected={active === 'board'} onClick={() => onChange('board')}>
        {`Pull Requests  ${boardCount}`}
      </Tab>
      <Tab role="tab" aria-selected={active === 'backports'} onClick={() => onChange('backports')}>
        {`Backports  ${backportsCount}`}
      </Tab>
      <Tab role="tab" aria-selected={active === 'tasks'} onClick={() => onChange('tasks')}>
        {`Tasks  ${tasksCount}`}
      </Tab>
    </Bar>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/TabBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: `App.tsx` now shows an error that it's missing the `tasksCount` prop on its `<TabBar>` call — expected, fixed in Task 14.

- [ ] **Step 6: Bump the version and commit**

```bash
git add src/ui/TabBar.tsx src/ui/TabBar.test.tsx package.json
git commit -m "feat: add a third Tasks tab to TabBar"
```

---

### Task 14: Wire the Tasks tab into `App.tsx`

**Files:**
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/App.test.tsx`

**Interfaces:**
- Consumes everything from Tasks 1–13: `TrackedTask`/`IssueEntry` (types), `buildQuery`/`parseResponse`/`fetchBoard` (generalized pipeline), `useTasks`, `parseTaskUrl`, `AddTaskDialog`, `TasksTab`, `TabBar`'s new `tasksCount` prop.
- Produces: the finished feature — `/tasks` route, live-polled Tasks tab, add via button/paste/drop, drag-reorder.

- [ ] **Step 1: Add imports**

In `src/ui/App.tsx`, add these imports alongside the existing ones (keep the existing import block's alphabetical grouping — insert each line in the position that matches):

```ts
import { parseTaskUrl } from '../github/parseTaskUrl';
import { useTasks } from '../hooks/useTasks';
```

and add `IssueEntry`, `TrackedTask` to the existing type-only import from `../types`:

```ts
import type { ColumnId, IssueEntry, PrEntry, PrKey, RateLimit, TrackedPr, TrackedTask, TransportError } from '../types';
```

and add these component imports alongside the existing ones:

```ts
import { AddTaskDialog } from './AddTaskDialog';
import { TasksTab } from './TasksTab';
```

- [ ] **Step 2: Add the `useTasks` hook and its derived state**

Immediately after the existing `useBackportGroups` call (which ends with the closing `});` before the `pollTargets` comment block), add:

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

- [ ] **Step 3: Generalize `pollTargets` to `TrackedTask[]`**

Replace the existing `pollTargets` memo:

```ts
  const pollTargets = useMemo(() => {
    const byKey = new Map<PrKey, TrackedPr>();
    for (const pr of prs) byKey.set(prKey(pr.owner, pr.repo, pr.number), pr);
    // First writer wins, deliberately: when the same PR is on the board *and* in
    // a group, the board's entry is the one that survives, because the board
    // owns the tracked list — its `addedAt`, and the owner/repo casing an
    // errored entry renders, come from there rather than from whichever loop
    // happened to run last.
    for (const group of groups) {
      for (const pr of groupPrs(group)) {
        const key = prKey(pr.owner, pr.repo, pr.number);
        if (!byKey.has(key)) byKey.set(key, pr);
      }
    }
    return [...byKey.values()];
  }, [prs, groups]);
```

with:

```ts
  const pollTargets = useMemo(() => {
    const byKey = new Map<PrKey, TrackedTask>();
    for (const pr of prs) byKey.set(prKey(pr.owner, pr.repo, pr.number), { ...pr, kind: 'pr' });
    // First writer wins, deliberately: when the same item is tracked on more
    // than one tab, the earliest-registered source's `addedAt` (and the
    // owner/repo casing an errored entry renders) is the one that survives —
    // see spec §4. Order here is board, then backports, then tasks.
    for (const group of groups) {
      for (const pr of groupPrs(group)) {
        const key = prKey(pr.owner, pr.repo, pr.number);
        if (!byKey.has(key)) byKey.set(key, { ...pr, kind: 'pr' });
      }
    }
    for (const task of tasks) {
      const key = prKey(task.owner, task.repo, task.number);
      if (!byKey.has(key)) byKey.set(key, task);
    }
    return [...byKey.values()];
  }, [prs, groups, tasks]);
```

- [ ] **Step 4: Add `issueEntries` state and populate it from the poll**

Change the existing entries state line:

```ts
  const [entries, setEntries] = useState<PrEntry[]>([]);
```

to also declare:

```ts
  const [entries, setEntries] = useState<PrEntry[]>([]);
  const [issueEntries, setIssueEntries] = useState<IssueEntry[]>([]);
```

Then, in the `poll` callback, change:

```ts
    reportTransportError(null);
    setEntries(outcome.result.entries);
    setRateLimit(outcome.result.rateLimit);
    setLastUpdatedAt(new Date(nowMs()).toISOString());
```

to:

```ts
    reportTransportError(null);
    setEntries(outcome.result.entries);
    setIssueEntries(outcome.result.issueEntries);
    setRateLimit(outcome.result.rateLimit);
    setLastUpdatedAt(new Date(nowMs()).toISOString());
```

- [ ] **Step 5: Build the Tasks tab's entry map**

Immediately after the existing `entryMap` memo:

```ts
  const entryMap = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries]);
```

add:

```ts
  // Board/Backports keep reading `entries`/`entryMap` exactly as before — this
  // is Tasks' own view, mixing in pr-kind entries it tracks plus every
  // issue-kind entry (issues are only ever tracked here, never on the other
  // two tabs).
  const taskEntryMap = useMemo(() => {
    const taskKeys = new Set(tasks.map((task) => prKey(task.owner, task.repo, task.number)));
    const map = new Map<PrKey, PrEntry | IssueEntry>();
    for (const entry of entries) {
      if (taskKeys.has(entry.key)) map.set(entry.key, entry);
    }
    for (const entry of issueEntries) {
      map.set(entry.key, entry);
    }
    return map;
  }, [entries, issueEntries, tasks]);
```

- [ ] **Step 6: Add task dialog state and the add-task callback**

Immediately after the existing `backportInitialUrl` state line:

```ts
  const [backportInitialUrl, setBackportInitialUrl] = useState<string | undefined>(undefined);
```

add:

```ts
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
```

Then, immediately after the existing `addGroupOrFlash` callback (which ends just before the "Spec round 2 §4" comment above `addFromText`), add:

```ts
  const addTaskParsed = useCallback(
    (parsed: Parameters<typeof addTask>[0]) => {
      const outcome = addTask(parsed);
      if (!outcome.added) flash(outcome.key);
      return outcome;
    },
    [addTask, flash],
  );
```

- [ ] **Step 7: Update `activeTab` and the routing redirect for `/tasks`**

Change:

```ts
  const activeTab: TabId = location === '/backports' ? 'backports' : 'board';
```

to:

```ts
  const activeTab: TabId =
    location === '/backports' ? 'backports' : location === '/tasks' ? 'tasks' : 'board';
```

Change the redirect effect:

```ts
  useEffect(() => {
    if (location !== '/pulls' && location !== '/backports') {
      navigate('/pulls', { replace: true });
    }
  }, [location, navigate]);
```

to:

```ts
  useEffect(() => {
    if (location !== '/pulls' && location !== '/backports' && location !== '/tasks') {
      navigate('/pulls', { replace: true });
    }
  }, [location, navigate]);
```

- [ ] **Step 8: Extend `addFromText` with a Tasks branch**

Replace:

```ts
  const addFromText = useCallback(
    (text: string) => {
      const parsed = parsePrUrl(text);
      if (!parsed.ok) {
        setInputError(parsed.error);
        return;
      }
      setInputError(null);
      if (activeTab === 'board') {
        addParsed(parsed.value);
        return;
      }
      setBackportInitialUrl(text);
      setBackportDialogOpen(true);
    },
    [activeTab, addParsed],
  );
```

with:

```ts
  const addFromText = useCallback(
    (text: string) => {
      if (activeTab === 'tasks') {
        const parsed = parseTaskUrl(text);
        if (!parsed.ok) {
          setInputError(parsed.error);
          return;
        }
        setInputError(null);
        addTaskParsed(parsed.value);
        return;
      }

      const parsed = parsePrUrl(text);
      if (!parsed.ok) {
        setInputError(parsed.error);
        return;
      }
      setInputError(null);
      if (activeTab === 'board') {
        addParsed(parsed.value);
        return;
      }
      setBackportInitialUrl(text);
      setBackportDialogOpen(true);
    },
    [activeTab, addParsed, addTaskParsed],
  );
```

- [ ] **Step 9: Update the `TopBar`, `TabBar`, tab render branch, storage-error banner, `DropOverlay`, and dialogs**

Change the `TopBar` render:

```tsx
      <TopBar
        onAdd={() => (activeTab === 'board' ? setAddOpen(true) : setBackportDialogOpen(true))}
        addLabel={activeTab === 'board' ? '+ Add PR' : '+ Track backports'}
```

to:

```tsx
      <TopBar
        onAdd={() =>
          activeTab === 'board'
            ? setAddOpen(true)
            : activeTab === 'backports'
              ? setBackportDialogOpen(true)
              : setTaskDialogOpen(true)
        }
        addLabel={
          activeTab === 'board' ? '+ Add PR' : activeTab === 'backports' ? '+ Track backports' : '+ Add task'
        }
```

Add a fourth storage-error banner immediately after the existing `backportStorageError` banner:

```tsx
      {backportStorageError === null ? null : (
        <Banner tone="warn" onDismiss={dismissBackportStorageError}>
          {backportStorageError}
        </Banner>
      )}
```

add:

```tsx
      {taskStorageError === null ? null : (
        <Banner tone="warn" onDismiss={dismissTaskStorageError}>
          {taskStorageError}
        </Banner>
      )}
```

Change the `TabBar` render:

```tsx
          <TabBar
            active={activeTab}
            onChange={(tab) => navigate(tab === 'board' ? '/pulls' : '/backports')}
            boardCount={prs.length - columns.archive.length}
            backportsCount={groups.filter((group) => !group.archived).length}
          />
```

to:

```tsx
          <TabBar
            active={activeTab}
            onChange={(tab) =>
              navigate(tab === 'board' ? '/pulls' : tab === 'backports' ? '/backports' : '/tasks')
            }
            boardCount={prs.length - columns.archive.length}
            backportsCount={groups.filter((group) => !group.archived).length}
            tasksCount={tasks.length}
          />
```

Change the tab-content branch:

```tsx
          {activeTab === 'board' ? (
            <BoardTab
              columns={columns}
              isEmpty={prs.length === 0}
              flashedKey={flashedKey}
              onRemove={handleRemove}
            />
          ) : (
            // `hasToken` is hardcoded because this whole branch is already
            // inside `token === null ? ... :` — BackportsTab's own no-token
            // empty state exists for its component tests, not for this call.
            <BackportsTab
              groups={groups}
              entries={entryMap}
              hasToken
              flashedKey={flashedKey}
              onRemoveGroup={removeGroup}
              onAddVersion={addVersion}
              onRemoveVersion={removeVersion}
              onFillSlot={fillSlot}
              onArchiveGroup={archiveGroup}
            />
          )}
```

to:

```tsx
          {activeTab === 'board' ? (
            <BoardTab
              columns={columns}
              isEmpty={prs.length === 0}
              flashedKey={flashedKey}
              onRemove={handleRemove}
            />
          ) : activeTab === 'backports' ? (
            // `hasToken` is hardcoded because this whole branch is already
            // inside `token === null ? ... :` — BackportsTab's own no-token
            // empty state exists for its component tests, not for this call.
            <BackportsTab
              groups={groups}
              entries={entryMap}
              hasToken
              flashedKey={flashedKey}
              onRemoveGroup={removeGroup}
              onAddVersion={addVersion}
              onRemoveVersion={removeVersion}
              onFillSlot={fillSlot}
              onArchiveGroup={archiveGroup}
            />
          ) : (
            <TasksTab
              tasks={tasks}
              entries={taskEntryMap}
              flashedKey={flashedKey}
              onRemoveTask={removeTask}
              onReorder={reorderTasks}
            />
          )}
```

Change the `DropOverlay` render:

```tsx
      <DropOverlay visible={isDragging && activeTab === 'board'} />
```

to:

```tsx
      <DropOverlay visible={isDragging && (activeTab === 'board' || activeTab === 'tasks')} />
```

Add the dialog immediately after the existing `<AddBackportGroupDialog>` block, before `<SettingsDialog>`:

```tsx
      <AddTaskDialog
        open={taskDialogOpen}
        onClose={() => setTaskDialogOpen(false)}
        onAdd={addTaskParsed}
      />
```

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. This is the last piece — every type mismatch flagged by earlier tasks' steps should now be resolved.

- [ ] **Step 11: Add integration tests to `App.test.tsx`**

Add a helper near the top of `src/ui/App.test.tsx`, immediately after the existing `boardResponder` function, for building responses that include issue nodes:

```ts
function issueNode(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    title: `Issue number ${number}`,
    url: `https://github.com/Example/example-server/issues/${number}`,
    state: 'OPEN',
    updatedAt: '2026-08-27T10:00:00Z',
    author: { login: 'octocat' },
    repository: { nameWithOwner: 'Example/example-server' },
    ...overrides,
  };
}
```

`boardResponder` already matches any alias whose query text contains `${alias}: repository` and wraps the given node under `{ pullRequest: node }` — for a mixed query it needs to also support wrapping under `{ issue: node }`. Update `boardResponder`'s body: leave it completely unchanged (it already wraps every configured node under `{ pullRequest: node }`, which is correct for every existing board/backports test). Add a **second**, small helper used only by the new Tasks tests, since only they need issue-shaped wrapping:

```ts
/** Like `boardResponder`, but wraps each configured node under `{ issue: node }`. */
function issueResponder(nodes: Record<string, unknown>) {
  return vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    const query = String(JSON.parse(String(init?.body)).query);
    const data: Record<string, unknown> = {
      rateLimit: { limit: 5000, cost: 1, remaining: 4812, resetAt: '2026-08-27T13:00:00Z' },
    };
    for (const [alias, node] of Object.entries(nodes)) {
      if (query.includes(`${alias}: repository`)) data[alias] = { issue: node };
    }
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}
```

Now add a new describe block at the end of the file, before the final closing of the file (after the last existing `describe` block's closing `});`):

```ts
describe('App — the Tasks tab', () => {
  it('starts empty and shows the prompt', async () => {
    render(
      <App deps={{ fetchImpl: vi.fn(), storage: fakeStorage({ [TOKEN_KEY]: storedToken }), clock, nowMs }} />,
    );
    window.history.pushState(null, '', '/tasks');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(
      await screen.findByText(/add an issue or pull request/i),
    ).toBeInTheDocument();
  });

  it('adds a PR task via the dialog and shows its live status after a poll', async () => {
    const fetchImpl = boardResponder({
      pr0: prNode(4821, { reviewDecision: 'APPROVED' }),
    });
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

    expect(await screen.findByText('Change number 4821')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/ready/i)).toBeInTheDocument());
  });

  it('adds an issue task and shows a waiting badge for an open issue', async () => {
    const fetchImpl = issueResponder({ pr0: issueNode(55) });
    render(
      <App deps={{ fetchImpl, storage: fakeStorage({ [TOKEN_KEY]: storedToken }), clock, nowMs }} />,
    );
    window.history.pushState(null, '', '/tasks');
    window.dispatchEvent(new PopStateEvent('popstate'));

    await userEvent.click(await screen.findByRole('button', { name: /add task/i }));
    await userEvent.type(
      screen.getByLabelText(/issue or pull request url/i),
      'https://github.com/Example/example-server/issues/55',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByText('Issue number 55')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/waiting/i)).toBeInTheDocument());
  });

  it('sends one mixed pr+issue query when both a board PR and a task issue are tracked', async () => {
    const fetchImpl = boardResponder({ pr0: prNode(4821) });
    const storage = fakeStorage({
      [TOKEN_KEY]: storedToken,
      [TRACKED_PRS_KEY]: storedPrs(4821),
    });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    window.history.pushState(null, '', '/tasks');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await userEvent.click(await screen.findByRole('button', { name: /add task/i }));
    await userEvent.type(
      screen.getByLabelText(/issue or pull request url/i),
      'https://github.com/Example/example-server/issues/55',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    const query = queryOf(fetchImpl);
    expect(query).toContain('pullRequest(number: 4821)');
    expect(query).toContain('issue(number: 55)');
    expect(query.match(/fragment prFields on PullRequest/g)).toHaveLength(1);
    expect(query.match(/fragment issueFields on Issue/g)).toHaveLength(1);
  });

  it('flashes rather than duplicates when the same task is added twice', async () => {
    const fetchImpl = boardResponder({ pr0: prNode(4821) });
    render(
      <App deps={{ fetchImpl, storage: fakeStorage({ [TOKEN_KEY]: storedToken }), clock, nowMs }} />,
    );
    window.history.pushState(null, '', '/tasks');
    window.dispatchEvent(new PopStateEvent('popstate'));

    for (let i = 0; i < 2; i += 1) {
      await userEvent.click(await screen.findByRole('button', { name: /add task/i }));
      await userEvent.type(
        screen.getByLabelText(/issue or pull request url/i),
        'https://github.com/Example/example-server/pull/4821',
      );
      await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    }

    expect(screen.getAllByTestId('task-row')).toHaveLength(1);
    expect(screen.getByTestId('task-row')).toHaveAttribute('data-flashed', 'true');
  });

  it('shows the tab count excluding nothing — every tracked task counts', async () => {
    const fetchImpl = boardResponder({ pr0: prNode(4821, { state: 'MERGED' }) });
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

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /^tasks/i })).toHaveTextContent('1'),
    );
  });
});

describe('App — routing (Tasks)', () => {
  it('renders the Tasks tab for /tasks', async () => {
    window.history.pushState(null, '', '/tasks');
    render(
      <App deps={{ fetchImpl: vi.fn(), storage: fakeStorage({ [TOKEN_KEY]: storedToken }), clock, nowMs }} />,
    );
    expect(await screen.findByRole('tab', { name: /^tasks/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
```

- [ ] **Step 12: Run the full suite**

Run: `npx vitest run`
Expected: PASS, every test file green, including every existing Board/Backports test (unaffected by this task's changes) and the new Tasks tests.

- [ ] **Step 13: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with no errors. Delete the resulting `dist/` directory afterward (`rm -rf dist`) — it's a build artifact, not something to commit.

- [ ] **Step 14: Bump the version and commit**

```bash
git add src/ui/App.tsx src/ui/App.test.tsx package.json
git commit -m "feat: wire the Tasks tab into App — routing, polling, add, reorder

Closes out docs/superpowers/plans/2026-09-03-tasks-tab-plan.md."
```

- [ ] **Step 15: Update the README**

Add a third bullet to the "What it does" section of `README.md`, matching the style of the existing Board/Backports paragraphs (see the two `**... tab**` paragraphs already there):

```markdown
**Tasks tab** — track GitHub issues and pull requests as a single manually ordered list: drag a row to reorder it, and each one shows live status (waiting, needs action, ready, merged, or closed). Full GitHub URLs only — issues and PRs share one number sequence per repo, so `owner/repo#N` can't say which type it names.
```

Insert it after the existing Backports paragraph (and its screenshot, if present) and before the closing "Both tabs poll GitHub every 15 seconds..." paragraph — update that closing paragraph's wording from "Both tabs" to "All three tabs" since it now applies to Tasks too.

```bash
git add README.md package.json
git commit -m "docs: mention the Tasks tab in the README"
```

(Bump the version for this commit too, per the Global Constraints — it's a user-facing description of shipped behavior, not a specs/plans-only doc change.)
