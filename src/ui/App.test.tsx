import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_KEY } from '../storage/token';
import { TRACKED_PRS_KEY } from '../storage/trackedPrs';
import { App } from './App';

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

  it('does not add a duplicate, and flashes the card that is already there', async () => {
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
