import { describe, expect, it, vi } from 'vitest';
import type { TrackedTask } from '../types';
import { GITHUB_GRAPHQL_URL, fetchBoard, fetchPrBody, validateToken } from './client';

const prs: TrackedTask[] = [
  {
    kind: 'pr',
    owner: 'Example',
    repo: 'example-server',
    number: 4821,
    addedAt: '2026-08-27T09:00:00Z',
  },
];

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function okBody() {
  return {
    data: {
      rateLimit: { limit: 5000, cost: 1, remaining: 4812, resetAt: '2026-08-27T11:00:00Z' },
      pr0: {
        pullRequest: {
          number: 4821,
          title: 'Fix index rotation',
          url: 'https://github.com/Example/example-server/pull/4821',
          state: 'OPEN',
          isDraft: false,
          updatedAt: '2026-08-27T10:00:00Z',
          author: { login: 'octocat' },
          baseRefName: 'master',
          repository: { nameWithOwner: 'Example/example-server' },
          reviewDecision: 'APPROVED',
          mergeable: 'MERGEABLE',
          reviewRequests: { totalCount: 0 },
          latestReviews: { nodes: [{ state: 'APPROVED' }] },
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: { state: 'SUCCESS', contexts: { totalCount: 0, nodes: [] } },
                },
              },
            ],
          },
        },
      },
    },
  };
}

describe('fetchBoard — request shape', () => {
  it('POSTs the query to the GraphQL endpoint with a bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(okBody()));
    await fetchBoard('ghp_example', prs, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(GITHUB_GRAPHQL_URL);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ghp_example');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body)).query).toContain('pr0: repository');
  });

  it('issues exactly one request no matter how many PRs are tracked', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(okBody()));
    const many: TrackedTask[] = Array.from({ length: 20 }, (_, index) => ({
      kind: 'pr',
      owner: 'Example',
      repo: 'example-server',
      number: index + 1,
      addedAt: '2026-08-27T09:00:00Z',
    }));
    await fetchBoard('t', many, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns the parsed board on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(okBody()));
    const outcome = await fetchBoard('t', prs, { fetchImpl });
    if (!outcome.ok) throw new Error(`expected success, got ${JSON.stringify(outcome.error)}`);
    expect(outcome.result.entries).toHaveLength(1);
    expect(outcome.result.rateLimit?.remaining).toBe(4812);
  });
});

describe('fetchBoard — transport failures', () => {
  it('maps a thrown fetch to a network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const outcome = await fetchBoard('t', prs, { fetchImpl });
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.kind).toBe('network');
  });

  it('maps 401 to an auth error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'Bad credentials' }, { status: 401 }));
    const outcome = await fetchBoard('t', prs, { fetchImpl });
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.kind).toBe('auth');
  });

  it('maps a 403 with an exhausted rate limit to a rate-limit error, with the reset time', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        { message: 'API rate limit exceeded' },
        {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1787000000',
          },
        },
      ),
    );
    const outcome = await fetchBoard('t', prs, { fetchImpl });
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.kind).toBe('rateLimited');
    if (outcome.error.kind !== 'rateLimited') return;
    expect(outcome.error.resetAt).toBe(new Date(1787000000 * 1000).toISOString());
  });

  it('maps a 403 with budget remaining to an auth error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        { message: 'Resource not accessible' },
        {
          status: 403,
          headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4000' },
        },
      ),
    );
    const outcome = await fetchBoard('t', prs, { fetchImpl });
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.kind).toBe('auth');
  });

  it('maps 429 to a rate-limit error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 429 }));
    const outcome = await fetchBoard('t', prs, { fetchImpl });
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.kind).toBe('rateLimited');
  });

  it('maps 5xx to a server error carrying the status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 502 }));
    const outcome = await fetchBoard('t', prs, { fetchImpl });
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.kind).toBe('server');
    if (outcome.error.kind !== 'server') return;
    expect(outcome.error.status).toBe(502);
  });

  it('maps a non-JSON body to a malformed error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>nope</html>', { status: 200 }));
    const outcome = await fetchBoard('t', prs, { fetchImpl });
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.kind).toBe('malformed');
  });

  it('maps a GraphQL RATE_LIMITED error to a rate-limit error even on a 200', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }),
      );
    const outcome = await fetchBoard('t', prs, { fetchImpl });
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.kind).toBe('rateLimited');
  });

  it('maps a 200 with a bad-credentials GraphQL error to an auth error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ errors: [{ message: 'Bad credentials' }] }));
    const outcome = await fetchBoard('t', prs, { fetchImpl });
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.kind).toBe('auth');
  });

  it('does not treat a credential-worded PER-ALIAS error as an auth failure', async () => {
    // GitHub's real wording for an org with an IP allow list matches every word
    // the old auth heuristic looked for, but it arrives with a `path` — it is one
    // repository refusing, not the token being rejected. Spec §9: a per-PR
    // failure must never take down its neighbours.
    const body = okBody();
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ...body,
        data: { ...body.data, pr1: null },
        errors: [
          {
            type: 'FORBIDDEN',
            path: ['pr1'],
            message:
              'Although you appear to have the correct authorization credentials, the `AcmeCorp` organization has an IP allow list enabled, and 1.2.3.4 is not permitted to access this resource.',
          },
        ],
      }),
    );
    const two: TrackedTask[] = [
      ...prs,
      {
        kind: 'pr',
        owner: 'AcmeCorp',
        repo: 'secrets',
        number: 7,
        addedAt: '2026-08-27T09:00:00Z',
      },
    ];

    const outcome = await fetchBoard('t', two, { fetchImpl });
    if (!outcome.ok) throw new Error(`expected success, got ${JSON.stringify(outcome.error)}`);
    expect(outcome.result.entries.map((entry) => entry.status)).toEqual(['ok', 'error']);
    const errored = outcome.result.entries[1];
    expect(errored?.status === 'error' ? errored.message : '').toMatch(/IP allow list/);
  });

  it('maps a request-level UNAUTHORIZED type to an auth error without reading the prose', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ errors: [{ type: 'UNAUTHORIZED', message: 'Resource not accessible.' }] }),
      );
    const outcome = await fetchBoard('t', prs, { fetchImpl });
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.kind).toBe('auth');
  });

  it('reads the reset time from the headers for a GraphQL RATE_LIMITED on a 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] },
        {
          headers: { 'content-type': 'application/json', 'x-ratelimit-reset': '1787000000' },
        },
      ),
    );
    const outcome = await fetchBoard('t', prs, { fetchImpl });
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.kind).toBe('rateLimited');
    if (outcome.error.kind !== 'rateLimited') return;
    expect(outcome.error.resetAt).toBe(new Date(1787000000 * 1000).toISOString());
  });

  it('survives an out-of-range x-ratelimit-reset header rather than throwing', async () => {
    // `new Date(seconds * 1000).toISOString()` throws a RangeError past ±8.64e15 ms,
    // and this call sits outside the try that wraps the fetch — it would reject
    // straight out of fetchBoard into React.
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {},
        {
          status: 429,
          headers: { 'content-type': 'application/json', 'x-ratelimit-reset': '99999999999999' },
        },
      ),
    );
    const outcome = await fetchBoard('t', prs, { fetchImpl });
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.kind).toBe('rateLimited');
    if (outcome.error.kind !== 'rateLimited') return;
    expect(outcome.error.resetAt).toBeNull();
  });

  it('never puts the token in an error message', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'Bad credentials' }, { status: 401 }));
    const outcome = await fetchBoard('ghp_secretvalue', prs, { fetchImpl });
    if (outcome.ok) throw new Error('expected failure');
    expect(JSON.stringify(outcome.error)).not.toContain('ghp_secretvalue');
  });
});

describe('validateToken', () => {
  it('returns the login on success', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { viewer: { login: 'octocat' } } }));
    const outcome = await validateToken('t', { fetchImpl });
    expect(outcome).toEqual({ ok: true, login: 'octocat' });
  });

  it('reports a failure for a rejected token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'Bad credentials' }, { status: 401 }));
    const outcome = await validateToken('t', { fetchImpl });
    expect(outcome.ok).toBe(false);
  });

  it('reports a failure when the response has no login', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { viewer: null } }));
    const outcome = await validateToken('t', { fetchImpl });
    expect(outcome.ok).toBe(false);
  });
});

describe('fetchPrBody', () => {
  it('POSTs a single-PR query for just the body field', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: { repository: { pullRequest: { body: 'hello' } } } }),
      );
    await fetchPrBody(
      't',
      { owner: 'Example', repo: 'example-server', number: 4821 },
      {
        fetchImpl,
      },
    );

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
    const outcome = await fetchPrBody(
      't',
      { owner: 'Example', repo: 'example-server', number: 4821 },
      {
        fetchImpl,
      },
    );
    expect(outcome).toEqual({ ok: true, body: 'the description' });
  });

  it('returns a null body when the PR does not resolve', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { repository: { pullRequest: null } } }));
    const outcome = await fetchPrBody(
      't',
      { owner: 'Example', repo: 'example-server', number: 1 },
      {
        fetchImpl,
      },
    );
    expect(outcome).toEqual({ ok: true, body: null });
  });

  it('returns a null body when the repository does not resolve', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { repository: null } }));
    const outcome = await fetchPrBody(
      't',
      { owner: 'nope', repo: 'nope', number: 1 },
      {
        fetchImpl,
      },
    );
    expect(outcome).toEqual({ ok: true, body: null });
  });

  it('surfaces a transport failure the same way fetchBoard and validateToken do', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'Bad credentials' }, { status: 401 }));
    const outcome = await fetchPrBody(
      't',
      { owner: 'Example', repo: 'example-server', number: 1 },
      {
        fetchImpl,
      },
    );
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.kind).toBe('auth');
  });
});
