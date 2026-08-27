import type { FetchOutcome, TrackedPr, TransportError } from '../types';
import { buildQuery } from './buildQuery';
import { parseResponse } from './parseResponse';

export const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

export type FetchBoardOptions = { fetchImpl?: typeof fetch };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resetFromHeaders(headers: Headers): string | null {
  const raw = headers.get('x-ratelimit-reset');
  if (raw === null) return null;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

/**
 * Maps an HTTP status to a transport error. Note the 403 fork: GitHub uses it
 * both for an exhausted rate limit and for a token without the needed access,
 * and only the remaining-budget header tells them apart.
 */
function errorForStatus(response: Response): TransportError | null {
  if (response.ok) return null;

  if (response.status === 401) {
    return { kind: 'auth', message: 'GitHub rejected the token. It may be invalid or expired.' };
  }
  if (response.status === 429) {
    return {
      kind: 'rateLimited',
      resetAt: resetFromHeaders(response.headers),
      message: 'GitHub is rate limiting requests.',
    };
  }
  if (response.status === 403) {
    if (response.headers.get('x-ratelimit-remaining') === '0') {
      return {
        kind: 'rateLimited',
        resetAt: resetFromHeaders(response.headers),
        message: 'The GitHub rate limit for this token is exhausted.',
      };
    }
    return {
      kind: 'auth',
      message: 'GitHub refused the request. The token may lack the required access.',
    };
  }
  return {
    kind: 'server',
    status: response.status,
    message: `GitHub responded with HTTP ${response.status}.`,
  };
}

/** GraphQL can report failure inside a 200 response, so the body needs checking too. */
function errorForBody(body: unknown): TransportError | null {
  const envelope = asRecord(body);
  if (!envelope || !Array.isArray(envelope.errors)) return null;

  for (const item of envelope.errors) {
    const error = asRecord(item);
    if (!error) continue;
    if (error.type === 'RATE_LIMITED') {
      return {
        kind: 'rateLimited',
        resetAt: null,
        message: 'The GitHub rate limit for this token is exhausted.',
      };
    }
    if (typeof error.message === 'string' && /credential|unauthorized|authentication/i.test(error.message)) {
      return { kind: 'auth', message: 'GitHub rejected the token. It may be invalid or expired.' };
    }
  }
  return null;
}

async function post(
  token: string,
  query: string,
  options: FetchBoardOptions,
): Promise<{ ok: true; body: unknown } | { ok: false; error: TransportError }> {
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(GITHUB_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
  } catch {
    // Deliberately does not include the thrown value: it is never useful here
    // and could conceivably echo the request.
    return {
      ok: false,
      error: { kind: 'network', message: 'Could not reach GitHub. Check your connection.' },
    };
  }

  const statusError = errorForStatus(response);
  if (statusError) return { ok: false, error: statusError };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: { kind: 'malformed', message: 'GitHub returned a response that could not be read.' },
    };
  }

  const bodyError = errorForBody(body);
  if (bodyError) return { ok: false, error: bodyError };

  return { ok: true, body };
}

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

/** Used by the settings dialog so a bad token is caught at entry, not at the next poll. */
export async function validateToken(
  token: string,
  options: FetchBoardOptions = {},
): Promise<{ ok: true; login: string } | { ok: false; error: string }> {
  const posted = await post(token, 'query { viewer { login } }', options);
  if (!posted.ok) return { ok: false, error: posted.error.message };

  const login = asRecord(asRecord(asRecord(posted.body)?.data)?.viewer)?.login;
  if (typeof login !== 'string' || login === '') {
    return { ok: false, error: 'GitHub accepted the request but returned no user.' };
  }
  return { ok: true, login };
}
