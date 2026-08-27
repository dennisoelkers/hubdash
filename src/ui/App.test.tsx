import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const nowMs = () => Date.parse('2026-08-27T12:00:00Z');
const clock = () => '2026-08-27T12:00:00Z';

beforeEach(() => {
  vi.restoreAllMocks();
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
    delete proto.scrollIntoView;
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
