# Backports Tab v2 — Routing, Drop-to-Create, Completion, Archive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Backports tab a bookmarkable URL, let a dropped PR link create a group from anywhere on the tab's background, mark a fully-landed group green, and let the user archive a fully-landed group into a collapsed section.

**Architecture:** `wouter`'s default browser-history hook becomes the single source of truth for which tab is showing, replacing `App`'s local `activeTab` state. The Backports tab's window-level drop/paste handler gains a second branch (open a pre-filled create dialog) instead of no-op'ing, guarded by a `stopPropagation()` call in `SlotRow` that keeps slot-drops from double-firing it. Completion styling is a pure CSS addition to an existing data attribute. Archiving is a new boolean field on `BackportGroup`, a version-2 storage migration, one new hook method following the codebase's existing `mapGroup` pattern, and a new `BackportGroupArchiveSection` component that is a structural copy of the board's `ArchiveSection`.

**Tech Stack:** React 19, TypeScript 5.7 (strict), Vite 6, styled-components 6, Vitest 3 + Testing Library, `wouter` 3.10.0 (new — the app's first runtime dependency besides React/styled-components).

**Spec:** `docs/superpowers/specs/2026-08-27-backports-tab-v2-design.md` — this plan argues from that spec; read both.

## Global Constraints

- `wouter` version `3.10.0` — its default `useLocation()` (browser-history hook) needs no `<Router>` wrapper; `main.tsx` does not change.
- Routes: `/pulls` → Board tab, `/backports` → Backports tab, `/` and any other path → redirect to `/pulls`.
- No new colors: completion styling reuses `tokens.color.good` (`#3fb950`), already defined in `src/ui/theme.ts`.
- Storage envelope version increments `1` → `2` for `hubdash.backports` (`BACKPORT_GROUPS_KEY`); a version-1 payload migrates in memory (every group gets `archived: false`); any other version is the existing "unsupported version, reset" path.
- No un-archiving, no deep link to a specific group, no change to duplicate-group version handling — all explicitly out of scope per spec §2.
- `DropOverlay`'s visibility stays `isDragging && activeTab === 'board'`, unchanged. The spec does not call for a drag-in-progress visual cue on the Backports tab, only for a *drop* there to do something; inventing an overlay change would be scope beyond the approved spec. The existing App test asserting board-only overlay visibility stays green as a regression guard.
- Every task ends with `npm test` (full suite) and `npx tsc --noEmit` both clean before committing.

---

### Task 1: Add wouter and derive the active tab from the URL

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm install`)
- Modify: `src/ui/App.tsx:1-27` (imports), `:146` (activeTab state), `:326-331` (TabBar wiring)
- Modify: `src/ui/App.test.tsx:1-8` (imports), `:107-109` (beforeEach), new `describe('App — routing', ...)` block

**Interfaces:**
- Consumes: `TabId` type from `./TabBar` (already imported in `App.tsx`); nothing from later tasks.
- Produces: `activeTab: TabId` derived from the URL, still read by every later task exactly as before (`activeTab === 'board'` / `'backports'`). No other task depends on how it's derived, only on its value and type being unchanged.

- [ ] **Step 1: Install wouter**

Run: `npm install wouter@3.10.0`

Confirm `package.json`'s `dependencies` now includes `"wouter": "^3.10.0"` (or the exact installed range npm writes).

- [ ] **Step 2: Write the failing routing tests**

In `src/ui/App.test.tsx`, change the top-level `beforeEach` (currently just `vi.restoreAllMocks();`) so every test starts from a known URL:

```ts
beforeEach(() => {
  vi.restoreAllMocks();
  window.history.pushState(null, '', '/pulls');
});
```

Then add this new describe block (placed after `describe('App — the Backports tab', ...)`, at the end of the file, before the final closing — i.e. as a new top-level block):

```ts
describe('App — routing', () => {
  it('renders the Board tab for /pulls', async () => {
    window.history.pushState(null, '', '/pulls');
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);
    expect(await screen.findByRole('tab', { name: /board/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders the Backports tab for /backports', async () => {
    window.history.pushState(null, '', '/backports');
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);
    expect(await screen.findByRole('tab', { name: /backports/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('redirects / to /pulls', async () => {
    window.history.pushState(null, '', '/');
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);
    await waitFor(() => expect(window.location.pathname).toBe('/pulls'));
    expect(screen.getByRole('tab', { name: /board/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('redirects an unknown path to /pulls', async () => {
    window.history.pushState(null, '', '/nope');
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);
    await waitFor(() => expect(window.location.pathname).toBe('/pulls'));
    expect(screen.getByRole('tab', { name: /board/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('updates the URL when a tab is clicked', async () => {
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);
    await userEvent.click(await screen.findByRole('tab', { name: /backports/i }));
    expect(window.location.pathname).toBe('/backports');
    await userEvent.click(screen.getByRole('tab', { name: /board/i }));
    expect(window.location.pathname).toBe('/pulls');
  });

  it('follows a browser back-navigation without a click', async () => {
    window.history.pushState(null, '', '/pulls');
    window.history.pushState(null, '', '/backports');
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);
    expect(await screen.findByRole('tab', { name: /backports/i })).toHaveAttribute('aria-selected', 'true');

    window.history.back();

    expect(await screen.findByRole('tab', { name: /board/i })).toHaveAttribute('aria-selected', 'true');
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run src/ui/App.test.tsx`
Expected: the six new `App — routing` tests fail (there is no `/pulls`/`/backports` route yet — `activeTab` is still local state defaulting to `'board'` regardless of URL, so e.g. the `/backports` test fails because the Backports tab never becomes selected, and the redirect tests fail because `window.location.pathname` never changes). All previously-passing tests should still pass, since `beforeEach` now setting the URL to `/pulls` has no effect on today's code.

- [ ] **Step 4: Implement URL-derived routing in App.tsx**

In `src/ui/App.tsx`, add the import (alongside the other named imports near the top of the file):

```ts
import { useLocation } from 'wouter';
```

Replace line 146:

```ts
const [activeTab, setActiveTab] = useState<TabId>('board');
```

with:

```ts
const [location, navigate] = useLocation();
const activeTab: TabId = location === '/backports' ? 'backports' : 'board';
```

Directly below the existing state-declaration block (after the `tick` state, before `reportTransportError`), add the redirect effect:

```ts
// Spec round 2 §3: the URL is the only source of truth for which tab shows.
// `/` and anything unrecognised settle on `/pulls`; `replace` so a redirect
// never leaves a dead entry in browser history.
useEffect(() => {
  if (location !== '/pulls' && location !== '/backports') {
    navigate('/pulls', { replace: true });
  }
}, [location, navigate]);
```

Update the `TabBar` render (previously `onChange={setActiveTab}`):

```tsx
<TabBar
  active={activeTab}
  onChange={(tab) => navigate(tab === 'board' ? '/pulls' : '/backports')}
  boardCount={prs.length}
  backportsCount={groups.length}
/>
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/ui/App.test.tsx`
Expected: all tests pass, including the six new ones.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/ui/App.tsx src/ui/App.test.tsx
git commit -m "feat: derive the active tab from the URL via wouter"
```

---

### Task 2: Stop a slot drop from reaching the window-level handler

**Files:**
- Modify: `src/ui/SlotRow.tsx:144-149`
- Test: `src/ui/SlotRow.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: a guarantee, consumed by Task 4, that a drop landing on an existing slot never bubbles to the `window`-level `drop` listener `useDragAndPaste` installs.

- [ ] **Step 1: Write the failing test**

Add to the `describe('SlotRow — filling by drop', ...)` block in `src/ui/SlotRow.test.tsx`:

```ts
it('stops the drop event from reaching the window', () => {
  const onFill = vi.fn().mockReturnValue({ ok: true });
  render(<SlotRow slot={EMPTY} entries={new Map()} onFill={onFill} onRemoveVersion={() => {}} />);
  const windowListener = vi.fn();
  window.addEventListener('drop', windowListener);
  try {
    const row = screen.getByTestId('slot-row');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: dataTransfer('https://github.com/Graylog2/graylog2-server/pull/4839') });
    act(() => void row.dispatchEvent(event));
    expect(windowListener).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener('drop', windowListener);
  }
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/ui/SlotRow.test.tsx -t "stops the drop event"`
Expected: FAIL — `windowListener` was called, because the event currently bubbles unimpeded.

- [ ] **Step 3: Add `stopPropagation`**

In `src/ui/SlotRow.tsx`, change the `Row`'s `onDrop` handler (lines 145-149):

```tsx
onDrop={(event) => {
  event.preventDefault();
  event.stopPropagation();
  const text = textFrom(event.dataTransfer);
  if (text !== '') fill(text);
}}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/ui/SlotRow.test.tsx`
Expected: all pass, including the new one.

- [ ] **Step 5: Commit**

```bash
git add src/ui/SlotRow.tsx src/ui/SlotRow.test.tsx
git commit -m "fix: stop a slot drop from also reaching the window-level handler"
```

---

### Task 3: Add `initialUrl` to AddBackportGroupDialog

**Files:**
- Modify: `src/ui/AddBackportGroupDialog.tsx`
- Test: `src/ui/AddBackportGroupDialog.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AddBackportGroupDialogProps.initialUrl?: string` — when set and the dialog opens, the main-PR field is pre-filled with it and focus moves to the versions field instead. Task 4 sets this prop from the drop handler.

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/AddBackportGroupDialog.test.tsx`:

```ts
describe('AddBackportGroupDialog — pre-filled from a drop', () => {
  it('pre-fills the URL field from initialUrl when opened', () => {
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        initialUrl={URL}
      />,
    );
    expect(screen.getByLabelText(/main pull request/i)).toHaveValue(URL);
  });

  it('moves focus to the versions field when pre-filled', () => {
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        initialUrl={URL}
      />,
    );
    expect(screen.getByLabelText(/backport to/i)).toHaveFocus();
  });

  it('focuses the URL field instead when opened without initialUrl', () => {
    render(<AddBackportGroupDialog open onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />);
    expect(screen.getByLabelText(/main pull request/i)).toHaveFocus();
  });

  it('leaves the URL field empty on a later open with no initialUrl', () => {
    const { rerender } = render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        initialUrl={URL}
      />,
    );
    expect(screen.getByLabelText(/main pull request/i)).toHaveValue(URL);
    rerender(
      <AddBackportGroupDialog open={false} onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />,
    );
    rerender(<AddBackportGroupDialog open onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />);
    expect(screen.getByLabelText(/main pull request/i)).toHaveValue('');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/ui/AddBackportGroupDialog.test.tsx -t "pre-filled from a drop"`
Expected: FAIL — TypeScript will also reject the unknown `initialUrl` prop once Step 3 hasn't happened yet; for now these tests fail at the assertion (empty value / wrong focus).

- [ ] **Step 3: Implement `initialUrl`**

In `src/ui/AddBackportGroupDialog.tsx`, update the props type:

```ts
export type AddBackportGroupDialogProps = {
  open: boolean;
  onClose: () => void;
  onAdd: (main: ParsedPr, versions: string[]) => { added: boolean; key: string };
  initialUrl?: string;
};
```

Update the function signature and the reset effect (previously lines 85-98):

```ts
export function AddBackportGroupDialog({ open, onClose, onAdd, initialUrl }: AddBackportGroupDialogProps) {
  const [url, setUrl] = useState('');
  const [versions, setVersions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const urlId = useId();
  const versionsId = useId();

  useEffect(() => {
    if (open) {
      setUrl(initialUrl ?? '');
    } else {
      setUrl('');
      setVersions('');
      setError(null);
    }
  }, [open, initialUrl]);
```

Update the two `Input`s' `autoFocus` (previously the URL input had a hardcoded `autoFocus`; the versions input had none):

```tsx
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
  onChange={(event) => setVersions(event.target.value)}
  placeholder="6.2, 6.1, 6.0"
/>
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/ui/AddBackportGroupDialog.test.tsx`
Expected: all pass.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/AddBackportGroupDialog.tsx src/ui/AddBackportGroupDialog.test.tsx
git commit -m "feat: let AddBackportGroupDialog open pre-filled with a main PR URL"
```

---

### Task 4: Wire drop-to-create on the Backports tab into App

**Files:**
- Modify: `src/ui/App.tsx:143-147` (state), `:230-245` (`addFromText`), `:358-362` (dialog render)
- Modify: `src/ui/App.test.tsx` — rewrite one existing test, add four new ones, update one comment

**Interfaces:**
- Consumes: `AddBackportGroupDialogProps.initialUrl` (Task 3); the guarantee that a slot-drop never reaches this handler (Task 2).
- Produces: nothing further tasks depend on — this is the end-to-end wiring for spec §4.

- [ ] **Step 1: Write the failing tests**

In `src/ui/App.test.tsx`, replace the existing test `'does not add a dropped link to the board while the Backports tab is active'` (in `describe('App — the Backports tab', ...)`) with:

```ts
it('opens the pre-filled create dialog, rather than adding to the board, when a link is dropped on the Backports background', async () => {
  const fetchImpl = vi.fn();
  const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
  render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);
  await userEvent.click(await screen.findByRole('tab', { name: /backports/i }));

  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(event, {
    dataTransfer: {
      types: ['text/plain'],
      getData: () => 'https://github.com/Graylog2/graylog2-server/pull/4821',
    },
  });
  await act(async () => {
    window.dispatchEvent(event);
  });

  expect(screen.getByRole('dialog', { name: /track backports/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/main pull request/i)).toHaveValue(
    'https://github.com/Graylog2/graylog2-server/pull/4821',
  );
  expect(screen.getByRole('tab', { name: /board/i })).toHaveTextContent('0');
  expect(storage.getItem(TRACKED_PRS_KEY)).toBeNull();
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('shows the parser error, and opens no dialog, for an unparseable link dropped on the Backports background', async () => {
  const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
  render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);
  await userEvent.click(await screen.findByRole('tab', { name: /backports/i }));

  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(event, {
    dataTransfer: { types: ['text/plain'], getData: () => 'https://gitlab.com/a/b/pull/1' },
  });
  await act(async () => {
    window.dispatchEvent(event);
  });

  expect(await screen.findByTestId('banner')).toHaveTextContent(/github\.com/i);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('does not also open the create dialog when a drop lands on an existing slot', async () => {
  const fetchImpl = boardResponder({ pr0: prNode(4821), pr1: prNode(4840) });
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
  await act(async () => {
    row.dispatchEvent(event);
  });

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('creates a group from a background drop once the pre-filled dialog is submitted', async () => {
  const fetchImpl = boardResponder({ pr0: prNode(4821) });
  const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
  render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);
  await userEvent.click(await screen.findByRole('tab', { name: /backports/i }));

  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(event, {
    dataTransfer: {
      types: ['text/plain'],
      getData: () => 'https://github.com/Graylog2/graylog2-server/pull/4821',
    },
  });
  await act(async () => {
    window.dispatchEvent(event);
  });

  await userEvent.type(screen.getByLabelText(/backport to/i), '6.2');
  await userEvent.click(screen.getByRole('button', { name: /^track$/i }));

  expect(await screen.findByText('#4821')).toBeInTheDocument();
});

it('creates nothing when the pre-filled dialog is cancelled', async () => {
  const fetchImpl = vi.fn();
  const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
  render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);
  await userEvent.click(await screen.findByRole('tab', { name: /backports/i }));

  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(event, {
    dataTransfer: {
      types: ['text/plain'],
      getData: () => 'https://github.com/Graylog2/graylog2-server/pull/4821',
    },
  });
  await act(async () => {
    window.dispatchEvent(event);
  });
  await screen.findByRole('dialog', { name: /track backports/i });

  await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /backports/i })).toHaveTextContent('0');
  expect(storage.getItem(BACKPORT_GROUPS_KEY)).toBeNull();
});
```

Note: the existing test `'fills a slot by dropping a link on it and the card updates on the next poll'` has a comment above its `act(...)` call reading "the drop updates state synchronously — twice, in fact: SlotRow's handler fills the slot, and the event also reaches useDragAndPaste's window listener." Update that comment now, since Task 2 makes it inaccurate:

```ts
// Wrapped in act because the drop updates state synchronously. SlotRow's own
// handler fills the slot and stops the event from reaching the window
// listener below (spec round 2 §4) — this only exercises the slot fill.
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/ui/App.test.tsx -t "Backports"`
Expected: the five new/rewritten tests fail — no dialog opens on a background drop yet (`addFromText` still no-ops on the Backports tab).

- [ ] **Step 3: Implement the drop-to-create branch**

In `src/ui/App.tsx`, add a new state declaration alongside `backportDialogOpen` (line 147):

```ts
const [backportInitialUrl, setBackportInitialUrl] = useState<string | undefined>(undefined);
```

Replace `addFromText` (previously lines 230-245):

```ts
// Spec round 2 §4: a valid link adds to the board when the Board tab is
// active, and opens the create-group dialog pre-filled when the Backports
// tab is active. A drop landing on an existing slot never reaches here —
// `SlotRow` stops it from propagating this far (Task 2).
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

Update the `AddBackportGroupDialog` render (previously lines 358-362):

```tsx
<AddBackportGroupDialog
  open={backportDialogOpen}
  onClose={() => {
    setBackportDialogOpen(false);
    setBackportInitialUrl(undefined);
  }}
  onAdd={addGroupOrFlash}
  initialUrl={backportInitialUrl}
/>
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/ui/App.test.tsx`
Expected: all pass.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.tsx src/ui/App.test.tsx
git commit -m "feat: open a pre-filled create dialog when a link is dropped on the Backports background"
```

---

### Task 5: Green completion styling on BackportGroupCard

**Files:**
- Modify: `src/ui/BackportGroupCard.tsx:25-40` (the `Card` styled component)
- Test: `src/ui/BackportGroupCard.test.tsx`

**Interfaces:**
- Consumes: `isComplete(group, entries)` (existing, `src/domain/backports.ts`) and the existing `data-complete` attribute — no new prop, no new attribute.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Write the failing test**

Add to the `describe('BackportGroupCard — display', ...)` block in `src/ui/BackportGroupCard.test.tsx`, right after the existing `'dims a fully-landed group'` test:

```ts
it('marks a fully-landed group green, on top of the existing dim', () => {
  setup({
    group: group({ slots: [{ version: '6.2', pr: tracked(4840) }] }),
    entries: entryMap([4821, 'MERGED'], [4840, 'MERGED']),
  });
  const card = screen.getByTestId('backport-group-card');
  expect(card).toHaveAttribute('data-complete', 'true');
  expect(card).toHaveStyle({ borderLeft: '2px solid #3fb950' });
  expect(card).toHaveStyle({ background: '#3fb9501a' });
});

it('does not mark an incomplete group green', () => {
  setup();
  const card = screen.getByTestId('backport-group-card');
  expect(card).not.toHaveStyle({ borderLeft: '2px solid #3fb950' });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/ui/BackportGroupCard.test.tsx -t "green"`
Expected: FAIL — no green styling exists yet.

- [ ] **Step 3: Add the CSS**

In `src/ui/BackportGroupCard.tsx`, change the `Card` styled component (previously lines 25-40):

```ts
const Card = styled.article`
  padding: ${tokens.space(3)} ${tokens.space(4)};
  background: ${tokens.color.surface};
  border: 1px solid ${tokens.color.border};
  border-left: 2px solid transparent;
  border-radius: ${tokens.radius};
  font-family: ${tokens.font.body};
  color: ${tokens.color.text};

  &[data-complete='true'] {
    opacity: 0.6;
    border-left: 2px solid ${tokens.color.good};
    background: ${tokens.color.good}1a;
  }

  &[data-flashed='true'] {
    outline: 2px solid ${tokens.color.accent};
  }
`;
```

(Adding the transparent `border-left` on the base rule keeps the card's width from shifting by 2px when it becomes complete.)

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/ui/BackportGroupCard.test.tsx`
Expected: all pass, including the two new ones and the pre-existing `'dims a fully-landed group'` test (still gated on the same `data-complete` attribute, unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/ui/BackportGroupCard.tsx src/ui/BackportGroupCard.test.tsx
git commit -m "feat: mark a fully-landed backport group green"
```

---

### Task 6: Add `archived` to the data model and migrate stored groups to version 2

**Files:**
- Modify: `src/types.ts:119-124` (`BackportGroup`)
- Modify: `src/storage/backportGroups.ts` (whole file)
- Modify: `src/domain/backports.test.ts:37-44` (`group` helper), `:148-150` (`named` helper)
- Modify: `src/ui/BackportGroupCard.test.tsx:21-31` (`group` helper)
- Modify: `src/ui/BackportsTab.test.tsx:10-12` (`group` helper)
- Modify: `src/hooks/useBackportGroups.ts:97-115` (`addGroup`)
- Modify: `src/hooks/useBackportGroups.test.tsx:40-49` (one `toEqual` expectation)
- Test: `src/storage/backportGroups.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `BackportGroup.archived: boolean` (required field) and `saveBackportGroups`/`loadBackportGroups` reading/writing envelope version `2`. Task 7 relies on `archived` existing on every group and on `addGroup` already setting it.

Note: fixing `addGroup`'s constructed object belongs here, not in Task 7 — the moment `types.ts` makes `archived` required (Step 1), `useBackportGroups.ts` stops compiling until its one `BackportGroup` literal gets the field too. Task 7 only adds the new `archiveGroup` method on top of an already-compiling hook.

- [ ] **Step 1: Add the field to the type**

In `src/types.ts`, change `BackportGroup` (previously lines 119-124):

```ts
export type BackportGroup = {
  main: TrackedPr;
  slots: BackportSlot[];
  /** ISO 8601, when the group was created. */
  addedAt: string;
  /** Set only by the user's own Archive action; never implied by isComplete. */
  archived: boolean;
};
```

- [ ] **Step 2: Fix every now-broken group literal**

This is a required, mechanical follow-on to Step 1 — every `BackportGroup` literal in the codebase must now include `archived`, or `tsc` fails.

In `src/domain/backports.test.ts`, add `archived: false` to both helpers:

```ts
function group(overrides: Partial<BackportGroup> = {}): BackportGroup {
  return {
    main: tracked(4821),
    slots: [slot('6.2', 4840), slot('6.1', 4841), slot('6.0', null)],
    addedAt: '2026-08-20T00:00:00Z',
    archived: false,
    ...overrides,
  };
}
```

```ts
function named(mainNumber: number, addedAt: string, slots: BackportSlot[]): BackportGroup {
  return { main: tracked(mainNumber), slots, addedAt, archived: false };
}
```

In `src/ui/BackportGroupCard.test.tsx`, add `archived: false` to its `group` helper:

```ts
function group(overrides: Partial<BackportGroup> = {}): BackportGroup {
  return {
    main: tracked(4821),
    slots: [
      { version: '6.2', pr: tracked(4840) },
      { version: '6.1', pr: null },
    ],
    addedAt: '2026-08-20T00:00:00Z',
    archived: false,
    ...overrides,
  };
}
```

In `src/ui/BackportsTab.test.tsx`, change its `group` helper to take an optional overrides argument, defaulting `archived` to `false` (this also gives Task 9 what it needs):

```ts
function group(mainNumber: number, addedAt: string, overrides: Partial<BackportGroup> = {}): BackportGroup {
  return { main: tracked(mainNumber), slots: [], addedAt, archived: false, ...overrides };
}
```

(`BackportGroup` is already imported as a type in this file.)

In `src/hooks/useBackportGroups.ts`, add `archived: false` to the group `addGroup` constructs (previously lines 97-115) — without this, the file stops compiling the moment `types.ts` makes `archived` required:

```ts
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
        archived: false,
      },
    ]);
    return { added: true, key };
  },
  [commit, now],
);
```

In `src/hooks/useBackportGroups.test.tsx`, the test `'adds a group with one slot per version, all empty'` does a full `toEqual` comparison — add `archived: false` to its expectation:

```ts
expect(result.current.groups).toEqual([
  {
    main: { ...MAIN, addedAt: '2026-08-27T12:00:00Z' },
    slots: [
      { version: '6.2', pr: null },
      { version: '6.1', pr: null },
    ],
    addedAt: '2026-08-27T12:00:00Z',
    archived: false,
  },
]);
```

- [ ] **Step 3: Write the failing storage-migration tests**

In `src/storage/backportGroups.test.ts`, update the top-level `group` fixture to include `archived: false`:

```ts
const group: BackportGroup = {
  main: { owner: 'Graylog2', repo: 'graylog2-server', number: 4821, addedAt: '2026-08-01T00:00:00Z' },
  slots: [
    { version: '6.2', pr: { owner: 'Graylog2', repo: 'graylog2-server', number: 4840, addedAt: '2026-08-02T00:00:00Z' } },
    { version: '6.1', pr: null },
  ],
  addedAt: '2026-08-20T00:00:00Z',
  archived: false,
};
```

Update `stored`'s default version from `1` to `2`, since it now builds envelopes in the *current* shape by default (version-1 payloads get their own dedicated tests below):

```ts
function stored(groups: unknown, version: unknown = 2): Record<string, string> {
  return { [BACKPORT_GROUPS_KEY]: JSON.stringify({ version, groups }) };
}
```

Update the `'writes a versioned envelope'` test's expectation from `version: 1` to `version: 2`:

```ts
it('writes a versioned envelope', () => {
  const storage = fakeStorage();
  saveBackportGroups([group], storage);
  expect(JSON.parse(storage.getItem(BACKPORT_GROUPS_KEY) ?? '')).toEqual({
    version: 2,
    groups: [group],
  });
});
```

Add these new tests to the `describe('loadBackportGroups', ...)` block:

```ts
it('migrates a version-1 payload, defaulting archived to false on every group', () => {
  const legacyGroup = {
    main: group.main,
    slots: group.slots,
    addedAt: group.addedAt,
  };
  const storage = fakeStorage(stored([legacyGroup], 1));
  expect(loadBackportGroups(storage)).toEqual({ groups: [{ ...legacyGroup, archived: false }], error: null });
});

it('round-trips a version-2 group whose archived is true', () => {
  const storage = fakeStorage();
  saveBackportGroups([{ ...group, archived: true }], storage);
  expect(loadBackportGroups(storage)).toEqual({ groups: [{ ...group, archived: true }], error: null });
});

it('rejects a version-2 group missing archived', () => {
  const bad = { main: group.main, slots: group.slots, addedAt: group.addedAt };
  expect(loadBackportGroups(fakeStorage(stored([bad], 2))).error).toBeTruthy();
});

it('rejects a version below 1 or above 2', () => {
  expect(loadBackportGroups(fakeStorage(stored([group], 0))).error).toMatch(/version/i);
  expect(loadBackportGroups(fakeStorage(stored([group], 3))).error).toMatch(/version/i);
});
```

The existing test `'rejects an unknown version'` already covers version `99`; leave it as-is.

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `npx vitest run src/storage/backportGroups.test.ts`
Expected: FAIL — the four new tests fail (no migration exists yet; `saveBackportGroups` still writes version 1); every other pre-existing test in this file also now fails to *type-check* because `group` needs `archived`, which Step 3 already added, so at this point only the new behavioral assertions should fail.

- [ ] **Step 5: Implement the migration**

Replace the full contents of `src/storage/backportGroups.ts`:

```ts
import type { BackportGroup, BackportSlot } from '../types';
import { readKey, writeKey } from './localStorage';
import { isTrackedPr } from './trackedPrs';

export const BACKPORT_GROUPS_KEY = 'hubdash.backports';
export const CORRUPT_BACKPORT_GROUPS_KEY = 'hubdash.backports.corrupt';

const CURRENT_VERSION = 2;

export type LoadBackportGroupsResult = { groups: BackportGroup[]; error: string | null };

const UNREADABLE = 'Your backport groups could not be read and were reset.';

function isSlot(value: unknown): value is BackportSlot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.version !== 'string' || candidate.version === '') return false;
  return candidate.pr === null || isTrackedPr(candidate.pr);
}

function isLegacyGroup(value: unknown): value is Omit<BackportGroup, 'archived'> {
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

function isGroup(value: unknown): value is BackportGroup {
  return isLegacyGroup(value) && typeof (value as Record<string, unknown>).archived === 'boolean';
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
  if (envelope.version !== 1 && envelope.version !== CURRENT_VERSION) {
    return reject(storage, raw, 'Your backport groups use an unsupported version and were reset.');
  }

  // A version-1 payload predates `archived`; every group it names gets the
  // only correct default for something that already exists — `false`.
  if (envelope.version === 1) {
    if (!Array.isArray(envelope.groups) || !envelope.groups.every(isLegacyGroup)) {
      return reject(storage, raw, UNREADABLE);
    }
    return {
      groups: envelope.groups.map((group) => ({ ...group, archived: false })),
      error: null,
    };
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
  writeKey(storage, BACKPORT_GROUPS_KEY, JSON.stringify({ version: CURRENT_VERSION, groups }));
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run src/storage/backportGroups.test.ts src/domain/backports.test.ts src/hooks/useBackportGroups.test.tsx src/ui/BackportGroupCard.test.tsx src/ui/BackportsTab.test.tsx`
Expected: all pass.

Run: `npx tsc --noEmit`
Expected: no errors (this confirms every `BackportGroup` literal in the repo now carries `archived`).

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/storage/backportGroups.ts src/domain/backports.test.ts src/ui/BackportGroupCard.test.tsx src/ui/BackportsTab.test.tsx src/hooks/useBackportGroups.ts src/hooks/useBackportGroups.test.tsx
git commit -m "feat: add archived to BackportGroup and migrate stored groups to version 2"
```

---

### Task 7: Add `archiveGroup` to useBackportGroups

**Files:**
- Modify: `src/hooks/useBackportGroups.ts:23-32` (result type), add `archiveGroup`, `:178-187` (returned object)
- Test: `src/hooks/useBackportGroups.test.tsx`

**Interfaces:**
- Consumes: `BackportGroup.archived` (Task 6); the existing `mapGroup` helper (`src/hooks/useBackportGroups.ts`, unchanged).
- Produces: `archiveGroup(key: PrKey): void` on `UseBackportGroupsResult`. Task 10 wires this into `App`.

- [ ] **Step 1: Write the failing tests**

Add to `src/hooks/useBackportGroups.test.tsx`, as a new describe block after `'useBackportGroups — storage errors'`:

```ts
describe('useBackportGroups — archiving', () => {
  it('archives a group by key and persists it', () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => useBackportGroups({ storage, clock }));
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    act(() => {
      result.current.archiveGroup(KEY);
    });
    expect(result.current.groups[0]?.archived).toBe(true);
    expect(JSON.parse(storage.getItem(BACKPORT_GROUPS_KEY) ?? '').groups[0].archived).toBe(true);
  });

  it('ignores archiving an unknown key', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, []);
    });
    act(() => {
      result.current.archiveGroup('nope/nope#1');
    });
    expect(result.current.groups[0]?.archived).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/hooks/useBackportGroups.test.tsx -t "archiving"`
Expected: FAIL — `result.current.archiveGroup` does not exist.

- [ ] **Step 3: Implement**

In `src/hooks/useBackportGroups.ts`, add `archiveGroup` to the result type (previously lines 23-32):

```ts
export type UseBackportGroupsResult = {
  groups: BackportGroup[];
  addGroup: (main: ParsedPr, versions: string[]) => { added: boolean; key: PrKey };
  removeGroup: (key: PrKey) => void;
  addVersion: (key: PrKey, version: string) => void;
  removeVersion: (key: PrKey, version: string) => void;
  fillSlot: (key: PrKey, version: string, pr: ParsedPr) => FillSlotOutcome;
  archiveGroup: (key: PrKey) => void;
  storageError: string | null;
  dismissStorageError: () => void;
};
```

Add `archiveGroup` after `fillSlot` (reusing `mapGroup`, the same helper `addVersion`/`removeVersion`/`fillSlot` already use — no new pattern):

```ts
const archiveGroup = useCallback(
  (key: PrKey) => {
    mapGroup(key, (group) => (group.archived ? null : { ...group, archived: true }));
  },
  [mapGroup],
);
```

Add it to the returned object (previously lines 178-187):

```ts
return {
  groups,
  addGroup,
  removeGroup,
  addVersion,
  removeVersion,
  fillSlot,
  archiveGroup,
  storageError,
  dismissStorageError,
};
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/hooks/useBackportGroups.test.tsx`
Expected: all pass.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useBackportGroups.ts src/hooks/useBackportGroups.test.tsx
git commit -m "feat: add archiveGroup to useBackportGroups"
```

---

### Task 8: Add the Archive button to BackportGroupCard

**Files:**
- Modify: `src/ui/BackportGroupCard.tsx:11-23` (props type), `:73-82` (styled buttons), `:124-169` (component + Header)
- Modify: `src/ui/BackportGroupCard.test.tsx` (`setup`'s prop defaults)

**Interfaces:**
- Consumes: `isComplete(group, entries)` (existing).
- Produces: `BackportGroupCardProps.onArchiveGroup: () => void` (required). Tasks 9 and 10 provide this callback, bound to the group's key, exactly like the existing `onRemoveGroup`.

- [ ] **Step 1: Write the failing tests**

In `src/ui/BackportGroupCard.test.tsx`, add `onArchiveGroup: vi.fn()` to `setup`'s prop defaults:

```ts
function setup(overrides: Partial<Parameters<typeof BackportGroupCard>[0]> = {}) {
  const props = {
    group: group(),
    entries: entryMap([4821, 'MERGED'], [4840, 'MERGED']),
    onRemoveGroup: vi.fn(),
    onAddVersion: vi.fn(),
    onRemoveVersion: vi.fn(),
    onFillSlot: vi.fn().mockReturnValue({ ok: true }),
    onArchiveGroup: vi.fn(),
    ...overrides,
  };
  render(<BackportGroupCard {...props} />);
  return props;
}
```

Add a new describe block after `'BackportGroupCard — actions'`:

```ts
describe('BackportGroupCard — archiving', () => {
  it('shows the Archive button when the group is complete', () => {
    setup({
      group: group({ slots: [{ version: '6.2', pr: tracked(4840) }] }),
      entries: entryMap([4821, 'MERGED'], [4840, 'MERGED']),
    });
    expect(screen.getByRole('button', { name: /^archive$/i })).toBeInTheDocument();
  });

  it('does not show the Archive button on an incomplete group', () => {
    setup();
    expect(screen.queryByRole('button', { name: /^archive$/i })).not.toBeInTheDocument();
  });

  it('calls onArchiveGroup when Archive is clicked', async () => {
    const onArchiveGroup = vi.fn();
    setup({
      group: group({ slots: [{ version: '6.2', pr: tracked(4840) }] }),
      entries: entryMap([4821, 'MERGED'], [4840, 'MERGED']),
      onArchiveGroup,
    });
    await userEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    expect(onArchiveGroup).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/ui/BackportGroupCard.test.tsx -t "archiving"`
Expected: FAIL — no Archive button exists yet.

- [ ] **Step 3: Implement**

In `src/ui/BackportGroupCard.tsx`, add `onArchiveGroup` to the props type (previously lines 11-23):

```ts
export type BackportGroupCardProps = {
  group: BackportGroup;
  entries: Map<PrKey, PrEntry>;
  onRemoveGroup: () => void;
  onAddVersion: (version: string) => void;
  onRemoveVersion: (version: string) => void;
  onFillSlot: (version: string, pr: ParsedPr) => { ok: true } | { ok: false; error: string };
  onArchiveGroup: () => void;
  /**
   * The group to signal, if any. Spec §10.5: re-adding an already-tracked main
   * PR flashes the existing card rather than creating a second one.
   */
  flashedKey?: PrKey | null;
};
```

Add a styled `ArchiveButton`, next to `RemoveGroup` (previously lines 73-82):

```ts
const RemoveGroup = styled.button`
  background: none;
  border: none;
  color: ${tokens.color.textMuted};
  cursor: pointer;

  &:hover {
    color: ${tokens.color.bad};
  }
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

  &:hover {
    color: ${tokens.color.text};
    border-color: ${tokens.color.accent};
  }
`;
```

Update the function signature and the `Header` (previously lines 124-169):

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
}: BackportGroupCardProps) {
```

```tsx
      <Header>
        <NumberLink
          href={`https://github.com/${group.main.owner}/${group.main.repo}/pull/${group.main.number}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          {`#${group.main.number}`}
        </NumberLink>
        <Title>{mainTitle}</Title>
        <RollUp>{`${landed} of ${total} landed`}</RollUp>
        {isComplete(group, entries) ? (
          <ArchiveButton type="button" onClick={onArchiveGroup}>
            Archive
          </ArchiveButton>
        ) : null}
        <RemoveGroup type="button" aria-label="Remove group" onClick={onRemoveGroup}>
          ✕
        </RemoveGroup>
      </Header>
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/ui/BackportGroupCard.test.tsx`
Expected: all pass.

Run: `npx tsc --noEmit`
Expected: no errors — this will surface every other caller of `BackportGroupCard` that now needs `onArchiveGroup` too; there are none yet (`BackportsTab` is Task 9), so none should error at this point.

- [ ] **Step 5: Commit**

```bash
git add src/ui/BackportGroupCard.tsx src/ui/BackportGroupCard.test.tsx
git commit -m "feat: show an Archive button on a fully-landed backport group"
```

---

### Task 9: Add BackportGroupArchiveSection and split active/archived groups in BackportsTab

**Files:**
- Create: `src/ui/BackportGroupArchiveSection.tsx`
- Modify: `src/ui/BackportsTab.tsx` (whole file)
- Test: `src/ui/BackportsTab.test.tsx`

**Interfaces:**
- Consumes: `BackportGroupCard` with its full prop set including `onArchiveGroup` (Task 8); `BackportGroup.archived` (Task 6); `groupKey`/`orderGroups` (existing, `src/domain/backports.ts`).
- Produces: `BackportsTabProps.onArchiveGroup: (key: PrKey) => void`. Task 10 wires this from `App`.

This mirrors the board's `ArchiveSection` (`src/ui/ArchiveSection.tsx`), which itself has no dedicated test file — its behavior is tested through `Board.test.tsx`'s `'ArchiveSection via Board'` block. `BackportGroupArchiveSection` follows the same convention: no standalone test file, tested through `BackportsTab.test.tsx` instead. Its `Cards` wrapper uses a vertical flex stack rather than `ArchiveSection`'s `Cards` grid — a `BackportGroupCard` is a wide block (slot rows, an inline form) unlike the compact `PrCard` the board's grid was sized for, and `BackportsTab`'s own active-group `List` already uses the same vertical stack for that reason.

- [ ] **Step 1: Write the failing tests**

In `src/ui/BackportsTab.test.tsx`, add the `makePr` import and a local `entryMap` helper (mirroring the one in `BackportGroupCard.test.tsx`):

```ts
import { makePr } from '../test/makePr';
```

```ts
function entryMap(...specs: Array<[number, 'OPEN' | 'CLOSED' | 'MERGED']>): Map<PrKey, PrEntry> {
  const map = new Map<PrKey, PrEntry>();
  for (const [number, lifecycle] of specs) {
    const pr = makePr({ number, lifecycle });
    map.set(pr.key, { status: 'ok', key: pr.key, tracked: tracked(number), pr });
  }
  return map;
}
```

Add `onArchiveGroup: vi.fn()` to `baseProps`:

```ts
function baseProps(overrides: Partial<Parameters<typeof BackportsTab>[0]> = {}) {
  return {
    groups: [],
    entries: new Map<PrKey, PrEntry>(),
    hasToken: true,
    flashedKey: null,
    onRemoveGroup: vi.fn(),
    onAddVersion: vi.fn(),
    onRemoveVersion: vi.fn(),
    onFillSlot: vi.fn().mockReturnValue({ ok: true }),
    onArchiveGroup: vi.fn(),
    ...overrides,
  };
}
```

Add a new describe block at the end of the file:

```ts
describe('BackportGroupArchiveSection via BackportsTab', () => {
  it('keeps an archived group out of the active list', () => {
    const groups = [
      group(1, '2026-08-01T00:00:00Z'),
      group(2, '2026-08-20T00:00:00Z', { archived: true }),
    ];
    render(<BackportsTab {...baseProps({ groups })} />);
    expect(screen.getAllByTestId('backport-group-card')).toHaveLength(1);
    expect(screen.getByTestId('backport-group-card')).toHaveTextContent('#1');
  });

  it('starts collapsed, showing a count but no cards', () => {
    const groups = [group(9, '2026-08-01T00:00:00Z', { archived: true })];
    render(<BackportsTab {...baseProps({ groups })} />);
    const toggle = screen.getByRole('button', { name: /archive/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('1');
    expect(screen.queryByText('#9')).not.toBeInTheDocument();
  });

  it('reveals its cards when expanded, and hides them again', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const groups = [group(9, '2026-08-01T00:00:00Z', { archived: true })];
    render(<BackportsTab {...baseProps({ groups })} />);
    const toggle = screen.getByRole('button', { name: /archive/i });

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('#9')).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.queryByText('#9')).not.toBeInTheDocument();
  });

  it('is not rendered at all when nothing is archived', () => {
    render(<BackportsTab {...baseProps({ groups: [group(1, '2026-08-01T00:00:00Z')] })} />);
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
  });

  it('routes onArchiveGroup with the right group key', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const onArchiveGroup = vi.fn();
    const groups = [
      group(4821, '2026-08-20T00:00:00Z', { slots: [{ version: '6.2', pr: tracked(4840) }] }),
    ];
    const entries = entryMap([4821, 'MERGED'], [4840, 'MERGED']);
    render(<BackportsTab {...baseProps({ groups, entries, onArchiveGroup })} />);
    await userEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    expect(onArchiveGroup).toHaveBeenCalledWith('graylog2/graylog2-server#4821');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/ui/BackportsTab.test.tsx -t "BackportGroupArchiveSection"`
Expected: FAIL — `BackportGroupArchiveSection` doesn't exist, `BackportsTab` doesn't accept or use `onArchiveGroup`, and every group renders regardless of `archived`.

- [ ] **Step 3: Create BackportGroupArchiveSection**

Create `src/ui/BackportGroupArchiveSection.tsx`:

```tsx
import { useState } from 'react';
import styled from 'styled-components';
import { groupKey } from '../domain/backports';
import type { ParsedPr } from '../github/parseUrl';
import type { BackportGroup, PrEntry, PrKey } from '../types';
import { BackportGroupCard } from './BackportGroupCard';
import { tokens } from './theme';

export type BackportGroupArchiveSectionProps = {
  groups: BackportGroup[];
  entries: Map<PrKey, PrEntry>;
  flashedKey: PrKey | null;
  onRemoveGroup: (key: PrKey) => void;
  onAddVersion: (key: PrKey, version: string) => void;
  onRemoveVersion: (key: PrKey, version: string) => void;
  onFillSlot: (key: PrKey, version: string, pr: ParsedPr) => { ok: true } | { ok: false; error: string };
  onArchiveGroup: (key: PrKey) => void;
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

const Cards = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${tokens.space(3)};
  margin-top: ${tokens.space(3)};
`;

/** Collapsed by default — a structural copy of the board's `ArchiveSection`. */
export function BackportGroupArchiveSection({
  groups,
  entries,
  flashedKey,
  onRemoveGroup,
  onAddVersion,
  onRemoveVersion,
  onFillSlot,
  onArchiveGroup,
}: BackportGroupArchiveSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (groups.length === 0) return null;

  return (
    <Wrapper data-testid="backport-archive">
      <Toggle type="button" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        Archive
        <span>{groups.length}</span>
      </Toggle>
      {expanded ? (
        <Cards>
          {groups.map((group) => {
            const key = groupKey(group);
            return (
              <BackportGroupCard
                key={key}
                group={group}
                entries={entries}
                flashedKey={flashedKey}
                onRemoveGroup={() => onRemoveGroup(key)}
                onAddVersion={(version) => onAddVersion(key, version)}
                onRemoveVersion={(version) => onRemoveVersion(key, version)}
                onFillSlot={(version, pr) => onFillSlot(key, version, pr)}
                onArchiveGroup={() => onArchiveGroup(key)}
              />
            );
          })}
        </Cards>
      ) : null}
    </Wrapper>
  );
}
```

- [ ] **Step 4: Split active/archived in BackportsTab**

Replace the full contents of `src/ui/BackportsTab.tsx`:

```tsx
import styled from 'styled-components';
import { groupKey, orderGroups } from '../domain/backports';
import type { ParsedPr } from '../github/parseUrl';
import type { BackportGroup, PrEntry, PrKey } from '../types';
import { BackportGroupArchiveSection } from './BackportGroupArchiveSection';
import { BackportGroupCard } from './BackportGroupCard';
import { Empty } from './Empty';
import { tokens } from './theme';

export type BackportsTabProps = {
  groups: BackportGroup[];
  entries: Map<PrKey, PrEntry>;
  hasToken: boolean;
  /** Forwarded to the cards; see `BackportGroupCard`'s own prop. */
  flashedKey: PrKey | null;
  onRemoveGroup: (key: PrKey) => void;
  onAddVersion: (key: PrKey, version: string) => void;
  onRemoveVersion: (key: PrKey, version: string) => void;
  onFillSlot: (key: PrKey, version: string, pr: ParsedPr) => { ok: true } | { ok: false; error: string };
  onArchiveGroup: (key: PrKey) => void;
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
  flashedKey,
  onRemoveGroup,
  onAddVersion,
  onRemoveVersion,
  onFillSlot,
  onArchiveGroup,
}: BackportsTabProps) {
  if (!hasToken) {
    return <Empty>Add a GitHub token in settings to start tracking backports.</Empty>;
  }
  if (groups.length === 0) {
    return <Empty>Track a pull request's backports — use the button above.</Empty>;
  }

  const active = groups.filter((group) => !group.archived);
  const archived = groups.filter((group) => group.archived);

  return (
    <List>
      {orderGroups(active, entries).map((group) => {
        const key = groupKey(group);
        return (
          <BackportGroupCard
            key={key}
            group={group}
            entries={entries}
            flashedKey={flashedKey}
            onRemoveGroup={() => onRemoveGroup(key)}
            onAddVersion={(version) => onAddVersion(key, version)}
            onRemoveVersion={(version) => onRemoveVersion(key, version)}
            onFillSlot={(version, pr) => onFillSlot(key, version, pr)}
            onArchiveGroup={() => onArchiveGroup(key)}
          />
        );
      })}
      <BackportGroupArchiveSection
        groups={archived}
        entries={entries}
        flashedKey={flashedKey}
        onRemoveGroup={onRemoveGroup}
        onAddVersion={onAddVersion}
        onRemoveVersion={onRemoveVersion}
        onFillSlot={onFillSlot}
        onArchiveGroup={onArchiveGroup}
      />
    </List>
  );
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/ui/BackportsTab.test.tsx`
Expected: all pass.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/BackportGroupArchiveSection.tsx src/ui/BackportsTab.tsx src/ui/BackportsTab.test.tsx
git commit -m "feat: collapse archived backport groups into their own section"
```

---

### Task 10: Wire archiving into App end-to-end

**Files:**
- Modify: `src/ui/App.tsx:98-107` (hook destructuring), `:343-352` (`BackportsTab` render)
- Modify: `src/ui/App.test.tsx` — add one new test

**Interfaces:**
- Consumes: `useBackportGroups().archiveGroup` (Task 7); `BackportsTabProps.onArchiveGroup` (Task 9).
- Produces: nothing further tasks depend on — this is the final integration point for spec §6.

- [ ] **Step 1: Write the failing test**

Add to `describe('App — the Backports tab', ...)` in `src/ui/App.test.tsx`:

```ts
it('archives a fully-landed group into the collapsed Archive section', async () => {
  // Only the slot's PR needs to be merged: `isComplete` excludes the main PR
  // from its count (it's the thing being backported, not a backport), so
  // leaving pr0 at its default OPEN state also keeps "merged" unambiguous —
  // otherwise both the main and slot status lines would say "merged" and
  // `findByText(/merged/i)` below would match two elements instead of one.
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
  await act(async () => {
    row.dispatchEvent(event);
  });
  await screen.findByText(/merged/i);

  await userEvent.click(await screen.findByRole('button', { name: /^archive$/i }));

  expect(screen.queryByTestId('backport-group-card')).not.toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: /archive/i });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(toggle);
  expect(screen.getByText('#4821')).toBeInTheDocument();

  const stored = JSON.parse(storage.getItem(BACKPORT_GROUPS_KEY) ?? '');
  expect(stored.groups[0].archived).toBe(true);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/ui/App.test.tsx -t "archives a fully-landed group"`
Expected: FAIL — `BackportsTab` isn't given an `onArchiveGroup`, so no Archive button's click does anything persistent (in fact `tsc` will already refuse to compile `App.tsx` once Task 9 lands, since `BackportsTabProps.onArchiveGroup` is required — this step is really about proving the *behavior*, not just satisfying the type).

- [ ] **Step 3: Implement**

In `src/ui/App.tsx`, add `archiveGroup` to the `useBackportGroups` destructuring (previously lines 98-107):

```ts
const {
  groups,
  addGroup,
  removeGroup,
  addVersion,
  removeVersion,
  fillSlot,
  archiveGroup,
  storageError: backportStorageError,
  dismissStorageError: dismissBackportStorageError,
} = useBackportGroups({ storage, clock });
```

Pass it to `BackportsTab` (previously lines 343-352):

```tsx
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/ui/App.test.tsx`
Expected: all pass.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: every test in the project passes.

Run: `npx tsc --noEmit` (equivalently `npm run build`'s first half)
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/App.tsx src/ui/App.test.tsx
git commit -m "feat: wire backport-group archiving into App"
```
