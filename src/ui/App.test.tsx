import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKPORT_GROUPS_KEY } from '../storage/backportGroups';
import { TOKEN_KEY } from '../storage/token';
import { TRACKED_PRS_KEY } from '../storage/trackedPrs';
import { App, POLL_INTERVAL_MS, RATE_LIMIT_FALLBACK_MS } from './App';

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

const storedToken = JSON.stringify({ version: 1, token: 'ghp_example' });

function storedPrs(...numbers: number[]) {
  return JSON.stringify({
    version: 1,
    prs: numbers.map((number) => ({
      owner: 'Graylog2',
      repo: 'graylog2-server',
      number,
      addedAt: '2026-08-27T09:00:00Z',
    })),
  });
}

function prNode(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    title: `Change number ${number}`,
    url: `https://github.com/Graylog2/graylog2-server/pull/${number}`,
    state: 'OPEN',
    isDraft: false,
    updatedAt: '2026-08-27T10:00:00Z',
    author: { login: 'dennisoelkers' },
    baseRefName: 'master',
    repository: { nameWithOwner: 'Graylog2/graylog2-server' },
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable: 'MERGEABLE',
    reviewRequests: { totalCount: 0 },
    latestReviews: { nodes: [] },
    commits: {
      nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { totalCount: 0, nodes: [] } } } }],
    },
    ...overrides,
  };
}

/** Replies to a board query with one node per requested alias. */
function boardResponder(nodes: Record<string, unknown>) {
  return vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    const query = String(JSON.parse(String(init?.body)).query);
    const data: Record<string, unknown> = {
      rateLimit: { limit: 5000, cost: 1, remaining: 4812, resetAt: '2026-08-27T13:00:00Z' },
    };
    for (const [alias, node] of Object.entries(nodes)) {
      if (query.includes(`${alias}: repository`)) data[alias] = { pullRequest: node };
    }
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

/**
 * The GraphQL query text one of `fetchImpl`'s calls actually sent. The body is
 * JSON-encoded, exactly the shape `boardResponder` above parses; asserting
 * against this asserts what GitHub was *asked*, not what happened to render.
 */
function queryOf(fetchImpl: { mock: { calls: unknown[] } }, callIndex = -1): string {
  const call: unknown = fetchImpl.mock.calls.at(callIndex);
  if (!Array.isArray(call)) throw new Error('fetchImpl was never called');
  const init: unknown = call[1];
  if (init === null || typeof init !== 'object' || !('body' in init)) {
    throw new Error('the request carried no body');
  }
  const body: unknown = JSON.parse(String(init.body));
  if (body === null || typeof body !== 'object' || !('query' in body)) {
    throw new Error('the request body carried no query');
  }
  return String(body.query);
}

/** Every `prN: repository(...)` alias in a query, as `alias owner/repo#number`. */
function aliasesIn(query: string): string[] {
  const pattern =
    /(pr\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)\s*\{\s*pullRequest\(number: (\d+)\)/g;
  return [...query.matchAll(pattern)].map(
    (match) => `${match[1] ?? ''} ${match[2] ?? ''}/${match[3] ?? ''}#${match[4] ?? ''}`,
  );
}

const nowMs = () => Date.parse('2026-08-27T12:00:00Z');
const clock = () => '2026-08-27T12:00:00Z';

beforeEach(() => {
  vi.restoreAllMocks();
  window.history.pushState(null, '', '/pulls');
});

afterEach(() => {
  vi.useRealTimers();
});

function jsonReply(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('App — first run', () => {
  it('asks for a token when none is stored, and does not call GitHub', async () => {
    const fetchImpl = vi.fn();
    render(<App deps={{ fetchImpl, storage: fakeStorage(), clock, nowMs }} />);

    expect(await screen.findByText(/add a github token/i)).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('asks for a PR when a token is stored but the board is empty, and does not call GitHub', async () => {
    const fetchImpl = vi.fn();
    render(
      <App deps={{ fetchImpl, storage: fakeStorage({ [TOKEN_KEY]: storedToken }), clock, nowMs }} />,
    );

    expect(await screen.findByText(/add a pull request/i)).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('App — the board', () => {
  it('polls once on mount and renders the cards in their columns', async () => {
    const fetchImpl = boardResponder({
      pr0: prNode(4821),
      pr1: prNode(4790, {
        commits: {
          nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: { totalCount: 1, nodes: [{ __typename: 'CheckRun', name: 'unit', conclusion: 'FAILURE', status: 'COMPLETED' }] } } } }],
        },
      }),
    });
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: storedPrs(4821, 4790) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

    await waitFor(() =>
      expect(within(screen.getByTestId('column-waiting')).getByText('#4821')).toBeInTheDocument(),
    );
    expect(within(screen.getByTestId('column-needsAction')).getByText('#4790')).toBeInTheDocument();
    expect(screen.getByText('● 1 failing')).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shows the rate limit and a freshness label after a successful poll', async () => {
    const fetchImpl = boardResponder({ pr0: prNode(4821) });
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: storedPrs(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

    await waitFor(() => expect(screen.getByTestId('rate-limit')).toHaveTextContent('4812'));
    expect(screen.getByTestId('freshness')).toHaveTextContent(/updated/);
  });

  it('polls again when Refresh is used', async () => {
    const fetchImpl = boardResponder({ pr0: prNode(4821) });
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: storedPrs(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });

  it('adds a PR through the dialog and shows it after the poll', async () => {
    const fetchImpl = boardResponder({ pr0: prNode(4821) });
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

    await userEvent.click(screen.getByRole('button', { name: /add pr/i }));
    await userEvent.type(
      screen.getByLabelText(/pull request url/i),
      'https://github.com/Graylog2/graylog2-server/pull/4821',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByText('#4821')).toBeInTheDocument();
    expect(JSON.parse(storage.getItem(TRACKED_PRS_KEY) ?? '').prs).toHaveLength(1);
  });

  it('shows a PR added while a poll is in flight, without waiting for the next tick', async () => {
    const responder = boardResponder({ pr0: prNode(4821), pr1: prNode(4790) });
    let releaseFirst: (() => void) | undefined;
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async (url: string, init?: RequestInit) => {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return responder(url, init);
      })
      .mockImplementation(responder);
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: storedPrs(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

    // The mount poll is still open; it was built before #4790 existed, so only
    // a second request can ever produce that card.
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: /add pr/i }));
    await userEvent.type(
      screen.getByLabelText(/pull request url/i),
      'https://github.com/Graylog2/graylog2-server/pull/4790',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await act(async () => {
      releaseFirst?.();
    });

    expect(await screen.findByText('#4790')).toBeInTheDocument();
    expect(screen.getByText('#4821')).toBeInTheDocument();
  });

  it('removes a PR from the board and from storage', async () => {
    const fetchImpl = boardResponder({ pr0: prNode(4821) });
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: storedPrs(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

    await screen.findByText('#4821');
    await userEvent.click(screen.getByRole('button', { name: /remove #4821/i }));

    await waitFor(() => expect(screen.queryByText('#4821')).not.toBeInTheDocument());
    expect(JSON.parse(storage.getItem(TRACKED_PRS_KEY) ?? '').prs).toEqual([]);
  });

  it('does not add a duplicate, and scrolls the card that is already there into view', async () => {
    // jsdom has no scrollIntoView, so observing spec §7.4's scroll means
    // installing one for the duration of this test.
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const scrolled: string[] = [];
    proto.scrollIntoView = function scrollIntoView(this: HTMLElement) {
      scrolled.push(this.textContent ?? '');
    };

    try {
      const fetchImpl = boardResponder({ pr0: prNode(4821) });
      const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: storedPrs(4821) });
      render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

      await screen.findByText('#4821');
      await userEvent.click(screen.getByRole('button', { name: /add pr/i }));
      await userEvent.type(
        screen.getByLabelText(/pull request url/i),
        'https://github.com/Graylog2/graylog2-server/pull/4821',
      );
      await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

      expect(screen.getAllByTestId('pr-card')).toHaveLength(1);
      await waitFor(() =>
        expect(screen.getByTestId('pr-card')).toHaveAttribute('data-flashed', 'true'),
      );
      expect(scrolled).toHaveLength(1);
      expect(scrolled[0]).toContain('#4821');
    } finally {
      // Never leave the prototype patched: a failure above would otherwise
      // silently change what every later test in this file is running against.
      delete proto.scrollIntoView;
    }
  });
});

describe('App — failure handling', () => {
  it('keeps the last good board on screen when a poll fails', async () => {
    const good = boardResponder({ pr0: prNode(4821) });
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(good)
      .mockRejectedValue(new TypeError('Failed to fetch'));
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: storedPrs(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

    await screen.findByText('#4821');
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));

    // The card must survive: a transport blip never blanks the board.
    await waitFor(() => expect(screen.getByTestId('banner')).toHaveTextContent(/could not reach/i));
    expect(screen.getByText('#4821')).toBeInTheDocument();
  });

  it('shows a persistent auth banner and stops polling on a rejected token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Bad credentials' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: storedPrs(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

    expect(await screen.findByTestId('banner')).toHaveTextContent(/token/i);
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    // Polling is stopped, so the count stays at the single mount attempt.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shows an errored card for a PR that cannot be resolved, without hiding its neighbours', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            rateLimit: { limit: 5000, cost: 1, remaining: 4800, resetAt: '2026-08-27T13:00:00Z' },
            pr0: { pullRequest: prNode(4821) },
            pr1: null,
          },
          errors: [{ message: 'Could not resolve to a Repository.', path: ['pr1'] }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: storedPrs(4821, 4790) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

    expect(await screen.findByText('#4821')).toBeInTheDocument();
    expect(screen.getByText(/Could not resolve to a Repository/)).toBeInTheDocument();
  });

  it('warns once about an unreadable stored PR list and lets it be dismissed', async () => {
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: 'not json{' });
    render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);

    const banner = await screen.findByTestId('banner');
    expect(banner).toHaveTextContent(/tracked pull requests/i);
    await userEvent.click(within(banner).getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByTestId('banner')).not.toBeInTheDocument();
  });

  it('reports an invalid dropped or pasted link without opening a dialog', async () => {
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);

    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(event, {
      clipboardData: {
        types: ['text/plain'],
        getData: () => 'https://gitlab.com/a/b/pull/1',
      },
    });
    // Wrapped in act because the listener sets state synchronously. Task 12's
    // equivalent test does the same; leaving it unwrapped emits a real act()
    // warning, and this project treats warnings as signal rather than noise.
    await act(async () => {
      document.dispatchEvent(event);
    });

    expect(await screen.findByTestId('banner')).toHaveTextContent(/github\.com/i);
  });
});

describe('App — opening Settings automatically', () => {
  it('opens Settings on launch when there is no stored token', async () => {
    render(<App deps={{ fetchImpl: vi.fn(), storage: fakeStorage(), clock, nowMs }} />);
    expect(await screen.findByRole('dialog', { name: /settings/i })).toBeInTheDocument();
  });

  it('does not open Settings on launch when a token is already stored', async () => {
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);
    await screen.findByText(/add a pull request/i);
    expect(screen.queryByRole('dialog', { name: /settings/i })).not.toBeInTheDocument();
  });

  it('closes the auto-opened dialog after a token is saved, revealing the board', async () => {
    const fetchImpl = boardResponder({ pr0: prNode(4821) });
    const validate = vi.fn().mockResolvedValue({ ok: true, login: 'dennisoelkers' });
    const storage = fakeStorage({ [TRACKED_PRS_KEY]: storedPrs(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs, validate }} />);

    expect(await screen.findByRole('dialog', { name: /settings/i })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/personal access token/i), 'ghp_new');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('#4821')).toBeInTheDocument();
  });
});

describe('App — the token', () => {
  it('reports an unreadable stored token and lets the warning be dismissed', async () => {
    // Global constraint: a malformed localStorage value is treated as absent
    // AND reported once. Silently falling back to "add a token" leaves the user
    // guessing why the token they entered yesterday is gone.
    const fetchImpl = vi.fn();
    const storage = fakeStorage({ [TOKEN_KEY]: 'not json{', [TRACKED_PRS_KEY]: storedPrs(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

    const banner = await screen.findByTestId('banner');
    expect(banner).toHaveTextContent(/saved token could not be read/i);
    expect(screen.getByText(/add a github token/i)).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();

    await userEvent.click(within(banner).getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByTestId('banner')).not.toBeInTheDocument();
  });

  it('starts polling once a token is saved through the settings dialog', async () => {
    const fetchImpl = boardResponder({ pr0: prNode(4821) });
    const validate = vi.fn().mockResolvedValue({ ok: true, login: 'dennisoelkers' });
    const storage = fakeStorage({ [TRACKED_PRS_KEY]: storedPrs(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs, validate }} />);

    expect(await screen.findByText(/add a github token/i)).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /settings/i }));
    await userEvent.type(screen.getByLabelText(/personal access token/i), 'ghp_new');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(validate).toHaveBeenCalledWith('ghp_new');
    expect(await screen.findByText('#4821')).toBeInTheDocument();
    expect(JSON.parse(storage.getItem(TOKEN_KEY) ?? '').token).toBe('ghp_new');
  });

  it('clears a rejected-token banner and resumes polling when a new token is saved', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async () => jsonReply({ message: 'Bad credentials' }, { status: 401 }))
      .mockImplementation(boardResponder({ pr0: prNode(4821) }));
    const validate = vi.fn().mockResolvedValue({ ok: true, login: 'dennisoelkers' });
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: storedPrs(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs, validate }} />);

    expect(await screen.findByTestId('banner')).toHaveTextContent(/token/i);

    await userEvent.click(screen.getByRole('button', { name: /settings/i }));
    await userEvent.type(screen.getByLabelText(/personal access token/i), 'ghp_fresh');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText('#4821')).toBeInTheDocument();
    expect(screen.queryByTestId('banner')).not.toBeInTheDocument();
  });
});

describe('App — freshness and the rate-limit backoff', () => {
  it('marks the freshness label stale only once two poll intervals have passed', async () => {
    // `shouldAdvanceTime` is required, not decorative: Testing Library only
    // recognises Jest's fake timers, so under plain vi.useFakeTimers() its
    // waitFor polls with a setInterval that is itself frozen and never returns.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let now = Date.parse('2026-08-27T12:00:00Z');
    const fetchImpl = boardResponder({ pr0: prNode(4821) });
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: storedPrs(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs: () => now }} />);

    await waitFor(() => expect(screen.getByTestId('freshness')).toHaveTextContent(/updated/));
    expect(screen.getByTestId('freshness')).toHaveAttribute('data-stale', 'false');

    // Exactly two intervals is still fresh — the threshold is strictly greater.
    now += POLL_INTERVAL_MS * 2;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('freshness')).toHaveAttribute('data-stale', 'false');

    // One second past it, and the label turns amber.
    now += 1000;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('freshness')).toHaveAttribute('data-stale', 'true');
  });

  it('names the reset time in the banner and resumes polling once it has passed', async () => {
    // `shouldAdvanceTime` is required, not decorative: Testing Library only
    // recognises Jest's fake timers, so under plain vi.useFakeTimers() its
    // waitFor polls with a setInterval that is itself frozen and never returns.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const resetAt = '2026-08-27T12:00:20.000Z';
    let now = Date.parse('2026-08-27T12:00:00Z');
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async () =>
        jsonReply(
          { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] },
          { headers: {
            'content-type': 'application/json',
            'x-ratelimit-reset': String(Date.parse(resetAt) / 1000),
          } },
        ),
      )
      .mockImplementation(boardResponder({ pr0: prNode(4821) }));
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: storedPrs(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs: () => now }} />);

    // Spec §9: the banner names the reset time.
    const banner = await screen.findByTestId('banner');
    expect(banner).toHaveTextContent(
      `Polling resumes at ${new Date(resetAt).toLocaleTimeString()}.`,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Backed off: ticks while the limit stands cost nothing.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now = Date.parse(resetAt) + 1000;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(await screen.findByText('#4821')).toBeInTheDocument();
  });

  it('recovers from a rate limit whose reset time GitHub never reported', async () => {
    // The dangerous shape: with resetAt null the backoff condition used to be
    // unconditionally true, so canPoll never came back and Refresh was a no-op
    // until the page was reloaded.
    // `shouldAdvanceTime` is required, not decorative: Testing Library only
    // recognises Jest's fake timers, so under plain vi.useFakeTimers() its
    // waitFor polls with a setInterval that is itself frozen and never returns.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let now = Date.parse('2026-08-27T12:00:00Z');
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async () => jsonReply({}, { status: 429 }))
      .mockImplementation(boardResponder({ pr0: prNode(4821) }));
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: storedPrs(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs: () => now }} />);

    expect(await screen.findByTestId('banner')).toHaveTextContent('Polling resumes shortly.');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += RATE_LIMIT_FALLBACK_MS + 1000;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(await screen.findByText('#4821')).toBeInTheDocument();
  });
});

describe('App — the Backports tab', () => {
  it('starts on the Board tab', async () => {
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);
    expect(await screen.findByRole('tab', { name: /board/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to Backports and shows its own empty state', async () => {
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);
    await userEvent.click(await screen.findByRole('tab', { name: /backports/i }));
    expect(screen.getByText(/track a pull request/i)).toBeInTheDocument();
  });

  it('creates a group and polls its main PR in the same request as the board', async () => {
    const fetchImpl = boardResponder({ pr0: prNode(4821), pr1: prNode(4900) });
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken, [TRACKED_PRS_KEY]: storedPrs(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);
    await screen.findByText('#4821');

    await userEvent.click(screen.getByRole('tab', { name: /backports/i }));
    await userEvent.click(screen.getByRole('button', { name: /track backports/i }));
    await userEvent.type(
      screen.getByLabelText(/main pull request/i),
      'https://github.com/Graylog2/graylog2-server/pull/4900',
    );
    await userEvent.click(screen.getByRole('button', { name: /^track$/i }));

    // Spec §9: one request covers the union. Asserted against the query that
    // was actually sent, because the card's `#4900` renders from the group's own
    // state whether or not the PR ever reached GitHub, and the call count rises
    // on any change to `groups` regardless of what the query contained.
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(aliasesIn(queryOf(fetchImpl))).toEqual([
      'pr0 Graylog2/graylog2-server#4821',
      'pr1 Graylog2/graylog2-server#4900',
    ]);
    expect(await screen.findByText('#4900')).toBeInTheDocument();
  });

  it('sends one alias, and renders one card, for a PR tracked on both tabs', async () => {
    const fetchImpl = boardResponder({ pr0: prNode(4821), pr1: prNode(4790) });
    const storage = fakeStorage({
      [TOKEN_KEY]: storedToken,
      [TRACKED_PRS_KEY]: storedPrs(4821, 4790),
    });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);
    await screen.findByText('#4821');

    await userEvent.click(screen.getByRole('tab', { name: /backports/i }));
    await userEvent.click(screen.getByRole('button', { name: /track backports/i }));
    // Deliberately different casing from the board's entry: `prKey` lowercases
    // owner and repo, so these are the same PR and must collapse to one alias.
    await userEvent.type(
      screen.getByLabelText(/main pull request/i),
      'https://github.com/graylog2/GRAYLOG2-SERVER/pull/4821',
    );
    await userEvent.click(screen.getByRole('button', { name: /^track$/i }));

    // Two aliases, not three: #4821 is asked about exactly once, and with the
    // board's own casing, because the board owns the tracked list.
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(aliasesIn(queryOf(fetchImpl))).toEqual([
      'pr0 Graylog2/graylog2-server#4821',
      'pr1 Graylog2/graylog2-server#4790',
    ]);

    // And the board still shows it once — a duplicated poll target would render
    // the same PR as two cards with duplicate React keys.
    await userEvent.click(screen.getByRole('tab', { name: /board/i }));
    expect(screen.getAllByText('#4821')).toHaveLength(1);
    expect(screen.getAllByText('Change number 4821')).toHaveLength(1);
  });

  it('flashes the existing group instead of creating a second for the same main PR', async () => {
    const fetchImpl = boardResponder({ pr0: prNode(4821) });
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

    await userEvent.click(await screen.findByRole('tab', { name: /backports/i }));
    const trackTwice = async (versions: string) => {
      await userEvent.click(screen.getByRole('button', { name: /track backports/i }));
      await userEvent.type(
        screen.getByLabelText(/main pull request/i),
        'https://github.com/Graylog2/graylog2-server/pull/4821',
      );
      if (versions !== '') await userEvent.type(screen.getByLabelText(/backport to/i), versions);
      await userEvent.click(screen.getByRole('button', { name: /^track$/i }));
    };
    await trackTwice('6.2');
    expect(screen.getAllByTestId('backport-group-card')).toHaveLength(1);

    // Spec §10.5: a duplicate main PR flashes the existing card. Silently
    // discarding the whole submission tells the user nothing happened.
    await trackTwice('6.1');
    expect(screen.getAllByTestId('backport-group-card')).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByTestId('backport-group-card')).toHaveAttribute('data-flashed', 'true'),
    );
  });

  it('fills a slot by dropping a link on it and the card updates on the next poll', async () => {
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
    // Wrapped in act because the drop updates state synchronously. SlotRow's own
    // handler fills the slot and stops the event from reaching the window
    // listener below (spec round 2 §4) — this only exercises the slot fill.
    await act(async () => {
      row.dispatchEvent(event);
    });

    expect(await screen.findByText(/merged/i)).toBeInTheDocument();
  });

  it('does not open the drop overlay while the Backports tab is active', async () => {
    const storage = fakeStorage({ [TOKEN_KEY]: storedToken });
    render(<App deps={{ fetchImpl: vi.fn(), storage, clock, nowMs }} />);
    await userEvent.click(await screen.findByRole('tab', { name: /backports/i }));

    const event = new Event('dragenter', { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: { types: ['text/uri-list'], getData: () => '' } });
    // Wrapped in act for the same reason: the drag listener sets isDragging
    // synchronously. The point of the test is that isDragging being true is no
    // longer enough to show the overlay while this tab is active.
    await act(async () => {
      window.dispatchEvent(event);
    });

    expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument();
  });

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

  it('reports an unreadable stored backport-groups value without touching the board', async () => {
    const storage = fakeStorage({
      [TOKEN_KEY]: storedToken,
      [TRACKED_PRS_KEY]: storedPrs(4821),
      [BACKPORT_GROUPS_KEY]: 'not json{',
    });
    const fetchImpl = boardResponder({ pr0: prNode(4821) });
    render(<App deps={{ fetchImpl, storage, clock, nowMs }} />);

    expect(await screen.findByText('#4821')).toBeInTheDocument();
    expect(screen.getByTestId('banner')).toHaveTextContent(/backport groups/i);
  });

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
});

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

    // Not `findByRole` + a single `toHaveAttribute`: jsdom dispatches `popstate`
    // for `history.back()` via its own `setTimeout(fn, 0)` (see jsdom's
    // SessionHistory#traverseHistory), a real macrotask. The Board tab element
    // already exists in the DOM (just with the wrong `aria-selected`), so a
    // one-shot `findByRole` resolves before that timer ever fires. `waitFor`
    // polls on a real interval, which reliably outlasts it.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /board/i })).toHaveAttribute('aria-selected', 'true'),
    );
  });
});
