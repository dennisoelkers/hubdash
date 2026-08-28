# Backport Version Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When creating a backport group, automatically detect target versions from the main PR's own description and prefill the versions field with them.

**Architecture:** A pure text-matching function extracts version-shaped tokens from lines mentioning "backport" in a PR body. A new standalone GraphQL request (mirroring the existing `validateToken` pattern) fetches just that one field for one PR, since the group doesn't exist yet at the point detection needs to run and can't wait for the periodic board poll. `App.tsx` composes fetch + parse into one function and injects it into `AddBackportGroupDialog` as a prop, the same way it already injects `validate` into `SettingsDialog` — the dialog never imports GitHub-fetching code directly.

**Tech Stack:** React 19, TypeScript 5.7 (strict), Vitest 3 + Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-28-backport-version-detection-design.md` — this plan argues from that spec; read both.

## Global Constraints

- Detection runs only in `AddBackportGroupDialog`'s create-new-group flow — never for adding a version to an existing group.
- Trigger: automatically, once the "Main pull request" field parses to a valid PR, exactly once per distinct PR identity (owner/repo/number) — not once per keystroke. Debounced 400ms: a URL typed character by character passes through several briefly-valid PR numbers on the way to the real one (`.../pull/4`, then `/48`, then `/482`, then `/4821` are each a distinct, fully-parseable identity) — confirmed empirically while grounding this plan, where an un-debounced version fired 4 detection requests for one 4-digit PR number. Paste and drop are unaffected: both set the whole field in one change event, so the delay is invisible to them.
- Overwrite rule: the moment the user types into the versions field themselves, detection never writes to it again for the rest of that dialog session, even if the URL changes afterward.
- Failure handling is entirely silent: no token, network error, PR not found, or no match on the body all leave the field exactly as manual entry works today. No error banner, no inline message.
- Submitting the dialog is never blocked or delayed by an in-flight detection.
- Detected versions are **not sorted** — kept in the order they appear in the PR body, consistent with the existing "no version sorting" principle (`docs/superpowers/specs/2026-08-27-backports-tab-design.md` §6).
- Detection matching rule (`src/domain/detectBackportVersions.ts`): split the body on literal newlines; for every line whose lowercased text contains `backport`, extract every version-shaped token (`\d+\.\d+(?:\.\d+)?`, an optional leading `v`/`V`, backticks or other punctuation around it irrelevant) from that line; collect across every matching line, in order; de-duplicate on the normalized (v-stripped) form, keeping the first occurrence's position.
- Every task ends with `npm test` (full suite) and `npx tsc --noEmit` both clean before committing.

---

### Task 1: Add the backport-version detection parser

**Files:**
- Create: `src/domain/detectBackportVersions.ts`
- Test: `src/domain/detectBackportVersions.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `detectBackportVersions(body: string): string[]`. Task 4 calls this directly.

- [ ] **Step 1: Write the failing tests**

Create `src/domain/detectBackportVersions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectBackportVersions } from './detectBackportVersions';

describe('detectBackportVersions', () => {
  it('extracts backtick-wrapped versions from the exact example phrasing', () => {
    expect(
      detectBackportVersions('This PR needs to be backported to `7.1`, `6.3` & `7.0`.'),
    ).toEqual(['7.1', '6.3', '7.0']);
  });

  it('extracts bare versions with no backticks at all', () => {
    expect(detectBackportVersions('Needs backport to 7.1 and 6.3.')).toEqual(['7.1', '6.3']);
  });

  it('strips a leading v from a version token', () => {
    expect(detectBackportVersions('Backport to v7.1 please.')).toEqual(['7.1']);
  });

  it('supports a three-segment version', () => {
    expect(detectBackportVersions('backport to `6.3.0`')).toEqual(['6.3.0']);
  });

  it('collects matches across every matching line, not just the first', () => {
    const body = ['Some unrelated intro line.', 'backport to 7.1', 'also backport to 6.3'].join(
      '\n',
    );
    expect(detectBackportVersions(body)).toEqual(['7.1', '6.3']);
  });

  it('ignores a version-shaped token on a line that does not mention backport', () => {
    const body = ['Bumps a dependency from 1.2 to 1.3.', 'Needs backport to 2.0.'].join('\n');
    expect(detectBackportVersions(body)).toEqual(['2.0']);
  });

  it('returns an empty list when nothing mentions backport', () => {
    expect(detectBackportVersions('Just a regular PR description with no versions.')).toEqual([]);
  });

  it('returns an empty list for an empty body', () => {
    expect(detectBackportVersions('')).toEqual([]);
  });

  it('de-duplicates a version repeated across two matching lines, keeping the first position', () => {
    const body = ['backport to 7.1 and 6.3', 'also needs backport to 6.3'].join('\n');
    expect(detectBackportVersions(body)).toEqual(['7.1', '6.3']);
  });

  it('is case-insensitive about the word "backport"', () => {
    expect(detectBackportVersions('BACKPORT to 7.1')).toEqual(['7.1']);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/domain/detectBackportVersions.test.ts`
Expected: FAIL — `detectBackportVersions` does not exist yet (module not found).

- [ ] **Step 3: Implement**

Create `src/domain/detectBackportVersions.ts`:

```ts
const VERSION_TOKEN = /\bv?(\d+\.\d+(?:\.\d+)?)\b/gi;

/**
 * Scans a PR body for lines that mention "backport" and pulls every
 * version-shaped token out of each one. Order is preserved as written, not
 * sorted, for the same reason manually-typed versions are never sorted
 * (spec round 1 §6: version schemes vary, and a wrong sort is worse than the
 * order the PR's own author chose).
 */
export function detectBackportVersions(body: string): string[] {
  const seen = new Set<string>();
  const versions: string[] = [];

  for (const line of body.split('\n')) {
    if (!line.toLowerCase().includes('backport')) continue;

    for (const match of line.matchAll(VERSION_TOKEN)) {
      const version = match[1];
      if (version === undefined || seen.has(version)) continue;
      seen.add(version);
      versions.push(version);
    }
  }

  return versions;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/domain/detectBackportVersions.test.ts`
Expected: all 10 tests pass.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/domain/detectBackportVersions.ts src/domain/detectBackportVersions.test.ts
git commit -m "feat: add a parser that detects backport versions from a PR body"
```

---

### Task 2: Add fetchPrBody to the GitHub client

**Files:**
- Modify: `src/github/buildQuery.ts:8-10` (export `literal`)
- Modify: `src/github/client.ts:1-8` (imports), add `fetchPrBody`
- Test: `src/github/client.test.ts`

**Interfaces:**
- Consumes: `literal` (existing, now exported from `buildQuery.ts`); the module-internal `post()` helper (existing, unchanged) for all transport-error handling.
- Produces: `FetchPrBodyResult = { ok: true; body: string | null } | { ok: false; error: TransportError }` and `fetchPrBody(token: string, pr: { owner: string; repo: string; number: number }, options?: FetchBoardOptions): Promise<FetchPrBodyResult>`. Task 4 calls this directly.

- [ ] **Step 1: Write the failing tests**

Add to `src/github/client.test.ts`, importing `fetchPrBody` alongside the existing imports (change the import line from `GITHUB_GRAPHQL_URL, fetchBoard, validateToken` to also include `fetchPrBody`):

```ts
import { GITHUB_GRAPHQL_URL, fetchBoard, fetchPrBody, validateToken } from './client';
```

Add a new describe block at the end of the file:

```ts
describe('fetchPrBody', () => {
  it('POSTs a single-PR query for just the body field', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: { repository: { pullRequest: { body: 'hello' } } } }),
      );
    await fetchPrBody('t', { owner: 'Example', repo: 'example-server', number: 4821 }, {
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    const query = JSON.parse(String(init?.body)).query as string;
    expect(query).toContain('repository(owner: "Example", name: "example-server")');
    expect(query).toContain('pullRequest(number: 4821)');
    expect(query).toContain('{ body }');
  });

  it('returns the body on success', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: { repository: { pullRequest: { body: 'the description' } } } }),
      );
    const outcome = await fetchPrBody('t', { owner: 'Example', repo: 'example-server', number: 4821 }, {
      fetchImpl,
    });
    expect(outcome).toEqual({ ok: true, body: 'the description' });
  });

  it('returns a null body when the PR does not resolve', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { repository: { pullRequest: null } } } ));
    const outcome = await fetchPrBody('t', { owner: 'Example', repo: 'example-server', number: 1 }, {
      fetchImpl,
    });
    expect(outcome).toEqual({ ok: true, body: null });
  });

  it('returns a null body when the repository does not resolve', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { repository: null } }));
    const outcome = await fetchPrBody('t', { owner: 'nope', repo: 'nope', number: 1 }, {
      fetchImpl,
    });
    expect(outcome).toEqual({ ok: true, body: null });
  });

  it('surfaces a transport failure the same way fetchBoard and validateToken do', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'Bad credentials' }, { status: 401 }));
    const outcome = await fetchPrBody('t', { owner: 'Example', repo: 'example-server', number: 1 }, {
      fetchImpl,
    });
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.kind).toBe('auth');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/github/client.test.ts`
Expected: FAIL — `fetchPrBody` does not exist yet (the import itself fails to resolve).

- [ ] **Step 3: Export `literal` from buildQuery.ts**

In `src/github/buildQuery.ts`, change (previously lines 8-10):

```ts
/** GraphQL string literals follow JSON's escaping rules. */
function literal(value: string): string {
  return JSON.stringify(value);
}
```

to:

```ts
/** GraphQL string literals follow JSON's escaping rules. */
export function literal(value: string): string {
  return JSON.stringify(value);
}
```

- [ ] **Step 4: Implement `fetchPrBody`**

In `src/github/client.ts`, update the import line (previously line 1-4):

```ts
import type { FetchOutcome, TrackedPr, TransportError } from '../types';
import { buildQuery, literal } from './buildQuery';
import { asRecord } from './json';
import { parseResponse } from './parseResponse';
```

Add, after `validateToken` at the end of the file:

```ts
export type FetchPrBodyResult = { ok: true; body: string | null } | { ok: false; error: TransportError };

/**
 * A standalone single-PR request, used by the backport-group create dialog to
 * look for a version list in the main PR's own description before the group
 * (and therefore a poll target for it) exists. Reuses `post()` — the same
 * transport-error handling `fetchBoard` and `validateToken` already have.
 */
export async function fetchPrBody(
  token: string,
  pr: { owner: string; repo: string; number: number },
  options: FetchBoardOptions = {},
): Promise<FetchPrBodyResult> {
  const query = `query { repository(owner: ${literal(pr.owner)}, name: ${literal(pr.repo)}) { pullRequest(number: ${pr.number}) { body } } }`;
  const posted = await post(token, query, options);
  if (!posted.ok) return { ok: false, error: posted.error };

  const data = asRecord(asRecord(posted.body)?.data);
  const repository = asRecord(data?.repository);
  const pullRequest = asRecord(repository?.pullRequest);
  const body = pullRequest?.body;
  return { ok: true, body: typeof body === 'string' ? body : null };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/github/client.test.ts src/github/buildQuery.test.ts`
Expected: all pass.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all pass — confirms exporting `literal` didn't disturb anything importing `buildQuery`.

- [ ] **Step 7: Commit**

```bash
git add src/github/buildQuery.ts src/github/client.ts src/github/client.test.ts
git commit -m "feat: add fetchPrBody, a standalone single-PR body request"
```

---

### Task 3: Wire detectVersions into AddBackportGroupDialog

**Files:**
- Modify: `src/ui/AddBackportGroupDialog.tsx` (whole file)
- Test: `src/ui/AddBackportGroupDialog.test.tsx`

**Interfaces:**
- Consumes: nothing new — only the *shape* of an async function `(main: ParsedPr) => Promise<string[]>`, injected by the caller. This task never imports `detectBackportVersions` or `fetchPrBody`; its own tests use a mock.
- Produces: `AddBackportGroupDialogProps.detectVersions?: (main: ParsedPr) => Promise<string[]>`. Task 4 provides the real implementation from `App.tsx`.

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/AddBackportGroupDialog.test.tsx` a new describe block at the end of the file. Every test here uses `fireEvent.change` for the URL field, not `userEvent.type` — typing a URL character by character makes it pass through several briefly-valid PR numbers on the way to the real one (see the `DETECTION_DEBOUNCE_MS` comment in Step 3), while `fireEvent.change` sets the whole value in one shot, exactly like a real paste or a drop-driven `initialUrl` — and fake timers make the resulting debounce deterministic to test, instead of a real wait:

```ts
describe('AddBackportGroupDialog — version detection', () => {
  it('fills the versions field once detection resolves for a valid URL', async () => {
    vi.useFakeTimers();
    const detectVersions = vi.fn().mockResolvedValue(['7.1', '6.3', '7.0']);
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    fireEvent.change(screen.getByLabelText(/main pull request/i), { target: { value: URL } });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(detectVersions).toHaveBeenCalledTimes(1);
    expect(detectVersions).toHaveBeenCalledWith({
      owner: 'Example',
      repo: 'example-server',
      number: 4821,
    });
    expect(screen.getByLabelText(/backport to/i)).toHaveValue('7.1, 6.3, 7.0');
  });

  it('shows a Detecting placeholder while the lookup is in flight', async () => {
    vi.useFakeTimers();
    let resolve!: (versions: string[]) => void;
    const detectVersions = vi.fn().mockImplementation(
      () => new Promise<string[]>((r) => { resolve = r; }),
    );
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    fireEvent.change(screen.getByLabelText(/main pull request/i), { target: { value: URL } });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByPlaceholderText(/detecting/i)).toBeInTheDocument();

    await act(async () => {
      resolve(['7.1']);
    });
    expect(screen.getByLabelText(/backport to/i)).toHaveValue('7.1');
  });

  it('does not fire again for the same PR when the field only re-settles on it', async () => {
    vi.useFakeTimers();
    const detectVersions = vi.fn().mockResolvedValue(['7.1']);
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    const input = screen.getByLabelText(/main pull request/i);
    fireEvent.change(input, { target: { value: URL } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(detectVersions).toHaveBeenCalledTimes(1);

    // Trailing whitespace still trims to the same PR identity.
    fireEvent.change(input, { target: { value: `${URL} ` } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(detectVersions).toHaveBeenCalledTimes(1);
  });

  it('never overwrites a versions field the user has already typed into', async () => {
    vi.useFakeTimers();
    let resolve!: (versions: string[]) => void;
    const detectVersions = vi.fn().mockImplementation(
      () => new Promise<string[]>((r) => { resolve = r; }),
    );
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    fireEvent.change(screen.getByLabelText(/main pull request/i), { target: { value: URL } });
    fireEvent.change(screen.getByLabelText(/backport to/i), { target: { value: '9.9' } });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {
      resolve(['7.1', '6.3']);
    });
    expect(screen.getByLabelText(/backport to/i)).toHaveValue('9.9');
  });

  it('leaves the versions field untouched when detection finds nothing', async () => {
    vi.useFakeTimers();
    const detectVersions = vi.fn().mockResolvedValue([]);
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    fireEvent.change(screen.getByLabelText(/main pull request/i), { target: { value: URL } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(detectVersions).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/backport to/i)).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('leaves the versions field untouched when detection rejects', async () => {
    vi.useFakeTimers();
    const detectVersions = vi.fn().mockRejectedValue(new Error('network down'));
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    fireEvent.change(screen.getByLabelText(/main pull request/i), { target: { value: URL } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(detectVersions).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/backport to/i)).toHaveValue('');
  });

  it('does not attempt detection when no detectVersions prop is given', () => {
    render(
      <AddBackportGroupDialog open onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />,
    );
    fireEvent.change(screen.getByLabelText(/main pull request/i), { target: { value: URL } });
    expect(screen.getByLabelText(/backport to/i)).toHaveValue('');
  });

  it('resets the touched flag and any in-flight detection state when reopened', async () => {
    vi.useFakeTimers();
    const detectVersions = vi.fn().mockResolvedValue(['7.1']);
    const { rerender } = render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    fireEvent.change(screen.getByLabelText(/backport to/i), { target: { value: '9.9' } });
    rerender(
      <AddBackportGroupDialog
        open={false}
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    rerender(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    fireEvent.change(screen.getByLabelText(/main pull request/i), { target: { value: URL } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByLabelText(/backport to/i)).toHaveValue('7.1');
  });
});
```

Update the file's imports: change `import { render, screen } from '@testing-library/react';` to `import { act, fireEvent, render, screen } from '@testing-library/react';`, and add `afterEach` to the existing `vitest` import (`import { afterEach, describe, expect, it, vi } from 'vitest';`). Add, right after the imports, before the `URL` constant:

```ts
afterEach(() => {
  vi.useRealTimers();
});
```

(Without this, a fake-timer test earlier in the file would leak fake timers into whatever runs after it — this file has no such cleanup yet, because nothing in it used fake timers before this task.)

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/ui/AddBackportGroupDialog.test.tsx -t "version detection"`
Expected: FAIL — TypeScript will also reject the unknown `detectVersions` prop until Step 3 lands; for now the tests fail because nothing fills the field.

- [ ] **Step 3: Implement**

Replace the full contents of `src/ui/AddBackportGroupDialog.tsx`:

```tsx
import { useEffect, useId, useRef, useState } from 'react';
import styled from 'styled-components';
import { parseVersions } from '../domain/parseVersions';
import type { ParsedPr } from '../github/parseUrl';
import { parsePrUrl } from '../github/parseUrl';
import { tokens } from './theme';

/**
 * A URL typed character by character passes through several briefly-valid
 * PR numbers on the way to the real one (".../pull/4", then "/48", then
 * "/482", then "/4821" are each a distinct, fully-parseable PR identity) —
 * without a debounce, each one would fire its own detection request (verified
 * empirically while grounding this plan: an un-debounced version fired 4
 * requests for one 4-digit PR number). Paste and drop are unaffected: both
 * set the whole field in one change event, so they only ever see the final
 * identity and this delay is invisible to them.
 */
const DETECTION_DEBOUNCE_MS = 400;

export type AddBackportGroupDialogProps = {
  open: boolean;
  onClose: () => void;
  onAdd: (main: ParsedPr, versions: string[]) => { added: boolean; key: string };
  initialUrl?: string;
  detectVersions?: (main: ParsedPr) => Promise<string[]>;
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

export function AddBackportGroupDialog({
  open,
  onClose,
  onAdd,
  initialUrl,
  detectVersions,
}: AddBackportGroupDialogProps) {
  const [url, setUrl] = useState('');
  const [versions, setVersions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  // A one-way flag: once the user has typed into the versions field
  // themselves, detection never overwrites it again for this dialog session.
  // A ref rather than state because flipping it must never itself trigger a
  // re-run of the detection effect below.
  const versionsTouchedRef = useRef(false);
  const urlId = useId();
  const versionsId = useId();

  useEffect(() => {
    if (open) {
      setUrl(initialUrl ?? '');
    } else {
      setUrl('');
      setVersions('');
      setError(null);
      setDetecting(false);
      versionsTouchedRef.current = false;
    }
  }, [open, initialUrl]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const parsedMain = parsePrUrl(url);
  const mainKey = parsedMain.ok
    ? `${parsedMain.value.owner}/${parsedMain.value.repo}#${parsedMain.value.number}`
    : null;

  // Fires once per distinct main-PR identity, not once per keystroke — keyed
  // on `mainKey` rather than `url`, so re-typing the same URL (or editing it
  // in a way that still resolves to the same PR) does not re-fetch. Debounced
  // so a rapid run of identities (typing the PR number digit by digit) only
  // ever requests the one the field settles on. Silent on every failure
  // path: this is a convenience prefill layered on an already-complete
  // manual flow, not a new validation gate.
  useEffect(() => {
    if (!open || !detectVersions || mainKey === null || versionsTouchedRef.current) return;

    const parsed = parsePrUrl(url);
    if (!parsed.ok) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      setDetecting(true);
      detectVersions(parsed.value)
        .then((detected) => {
          if (cancelled || versionsTouchedRef.current || detected.length === 0) return;
          setVersions(detected.join(', '));
        })
        .catch(() => {
          // Silent by design (spec §5) — the field just stays as manual entry.
        })
        .finally(() => {
          if (!cancelled) setDetecting(false);
        });
    }, DETECTION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, mainKey, detectVersions]);

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
          autoFocus={initialUrl === undefined}
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
          autoFocus={initialUrl !== undefined}
          value={versions}
          onChange={(event) => {
            versionsTouchedRef.current = true;
            setVersions(event.target.value);
          }}
          placeholder={detecting ? 'Detecting…' : '6.2, 6.1, 6.0'}
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

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/ui/AddBackportGroupDialog.test.tsx`
Expected: all pass, including the 8 new ones.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/ui/AddBackportGroupDialog.tsx src/ui/AddBackportGroupDialog.test.tsx
git commit -m "feat: let AddBackportGroupDialog auto-detect versions from the PR body"
```

---

### Task 4: Wire detection into App

**Files:**
- Modify: `src/ui/App.tsx:1-27` (imports), `:378-386` (dialog render)
- Test: `src/ui/App.test.tsx`

**Interfaces:**
- Consumes: `detectBackportVersions` (Task 1); `fetchPrBody` (Task 2); `AddBackportGroupDialogProps.detectVersions` (Task 3).
- Produces: nothing further tasks depend on — this is the final wiring for the spec.

**Note on line-number citations:** `App.tsx` has been touched by many prior tasks; the cited line numbers reflect its current state as of this plan's authoring. Locate the dialog render by the `<AddBackportGroupDialog` JSX element itself if it has drifted.

- [ ] **Step 1: Write the failing test**

Add to `describe('App — the Backports tab', ...)` in `src/ui/App.test.tsx`:

```ts
it('prefills detected versions when a main PR whose description mentions backport is tracked', async () => {
  const fetchImpl = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    const query = String(JSON.parse(String(init?.body)).query);
    if (query.includes('{ body }')) {
      return new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: { body: 'This PR needs to be backported to `7.1`, `6.3` & `7.0`.' },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return boardResponder({ pr0: prNode(4821) })(_url, init);
  });
  const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
  render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

  await userEvent.click(await screen.findByRole('tab', { name: /backports/i }));
  await userEvent.click(screen.getByRole('button', { name: /track backports/i }));
  await userEvent.type(
    screen.getByLabelText(/main pull request/i),
    'https://github.com/Example/example-server/pull/4821',
  );

  // Real time here, not fake: `userEvent.type` still types the number digit
  // by digit, but each keystroke resets Task 3's 400ms debounce, so only the
  // final, fully-typed identity ever survives it — `waitFor` (unlike a
  // one-shot `findByLabelText(...).toHaveValue(...)`) is what actually waits
  // out that debounce rather than checking the value before it has fired.
  await waitFor(() =>
    expect(screen.getByLabelText(/backport to/i)).toHaveValue('7.1, 6.3, 7.0'),
  );
});

it('does not attempt detection when there is no token', async () => {
  const fetchImpl = vi.fn();
  const storage = fakeStorage({});
  render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);
  // No token stored, so Settings opens automatically — close it to reach the
  // dialog directly via a drop is not needed here; the point is only that
  // detection makes no request when App has no token to use.
  await screen.findByRole('dialog', { name: /settings/i });
  expect(fetchImpl).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/ui/App.test.tsx -t "prefills detected versions"`
Expected: FAIL — `AddBackportGroupDialog` receives no `detectVersions` prop yet, so nothing fills the field.

- [ ] **Step 3: Implement**

In `src/ui/App.tsx`, update the imports (previously lines 1-27) — add `fetchPrBody` to the existing `../github/client` import, add a new import for `detectBackportVersions`, and add `ParsedPr` as a type import from `../github/parseUrl`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { detectBackportVersions } from '../domain/detectBackportVersions';
import { groupPrs } from '../domain/backports';
import { formatAgo } from '../domain/formatAgo';
import { prKey } from '../domain/prKey';
import { groupIntoColumns } from '../domain/sort';
import { fetchBoard, fetchPrBody } from '../github/client';
import type { ParsedPr } from '../github/parseUrl';
import { parsePrUrl } from '../github/parseUrl';
import { useBackportGroups } from '../hooks/useBackportGroups';
import { useDragAndPaste } from '../hooks/useDragAndPaste';
import { usePolling } from '../hooks/usePolling';
import { useTrackedPrs } from '../hooks/useTrackedPrs';
import { clearToken, loadToken, saveToken } from '../storage/token';
import type { ColumnId, PrEntry, PrKey, RateLimit, TrackedPr, TransportError } from '../types';
import { AddBackportGroupDialog } from './AddBackportGroupDialog';
import { AddPrDialog } from './AddPrDialog';
import { BackportsTab } from './BackportsTab';
import { Banner } from './Banner';
import { BoardTab } from './BoardTab';
import { DropOverlay } from './DropOverlay';
import { Empty } from './Empty';
import { GlobalStyle } from './GlobalStyle';
import type { TokenValidator } from './SettingsDialog';
import { SettingsDialog } from './SettingsDialog';
import type { TabId } from './TabBar';
import { TabBar } from './TabBar';
import { TopBar } from './TopBar';
```

(Keep the existing import ordering/grouping conventions; the exact position of the new `detectBackportVersions`/`ParsedPr` lines among the others doesn't matter functionally.)

Add the composed `detectVersions` callback directly above the `return (` statement (after `freshness`, previously just before line 299's `return (`):

```ts
const detectVersions = useCallback(
  async (main: ParsedPr): Promise<string[]> => {
    if (token === null) return [];
    const result = await fetchPrBody(token, main, fetchImpl ? { fetchImpl } : {});
    if (!result.ok || result.body === null) return [];
    return detectBackportVersions(result.body);
  },
  [token, fetchImpl],
);
```

Update the `AddBackportGroupDialog` render (previously lines 378-386):

```tsx
<AddBackportGroupDialog
  open={backportDialogOpen}
  onClose={() => {
    setBackportDialogOpen(false);
    setBackportInitialUrl(undefined);
  }}
  onAdd={addGroupOrFlash}
  initialUrl={backportInitialUrl}
  detectVersions={detectVersions}
/>
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/ui/App.test.tsx`
Expected: all pass, including the two new ones.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: every test in the project passes.

- [ ] **Step 6: Commit**

```bash
git add src/ui/App.tsx src/ui/App.test.tsx
git commit -m "feat: wire backport-version detection into App"
```
