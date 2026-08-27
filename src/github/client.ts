import type { FetchOutcome, TrackedPr, TransportError } from '../types';
import { buildQuery } from './buildQuery';
import { asRecord } from './json';
import { parseResponse } from './parseResponse';

export const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

export type FetchBoardOptions = { fetchImpl?: typeof fetch };

/** The largest value `new Date(ms)` represents; beyond it `toISOString` throws a RangeError. */
const MAX_TIME_MS = 8.64e15;

function resetFromHeaders(headers: Headers): string | null {
  const raw = headers.get('x-ratelimit-reset');
  if (raw === null) return null;
  const ms = Number.parseInt(raw, 10) * 1000;
  // The range check is load-bearing, not defensive dressing: this runs outside
  // the try that wraps the fetch, so a RangeError here would reject straight
  // out of fetchBoard and into a React render.
  return Number.isFinite(ms) && Math.abs(ms) <= MAX_TIME_MS ? new Date(ms).toISOString() : null;
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

/**
 * GraphQL can report failure inside a 200 response, so the body needs checking
 * too — but only failures of the request AS A WHOLE belong here.
 *
 * A GraphQL `errors[]` mixes two very different things: request-level errors,
 * which have no `path`, and per-alias errors, which name the field that failed.
 * Only the former may fail the whole poll. `parseResponse` already owns the
 * latter, turning each into an errored entry beside its healthy neighbours
 * (spec §9). Reacting to a per-alias error here would discard good data for
 * every other PR and raise a non-dismissable banner about a token that is fine
 * — GitHub's message for an org with an IP allow list opens with "Although you
 * appear to have the correct authorization credentials…", which is exactly the
 * prose an auth heuristic goes looking for.
 *
 * `type` is therefore preferred over the message: the wording is GitHub's to
 * change, the error type is part of the contract.
 */
function errorForBody(body: unknown, headers: Headers): TransportError | null {
  const envelope = asRecord(body);
  if (!envelope || !Array.isArray(envelope.errors)) return null;

  for (const item of envelope.errors) {
    const error = asRecord(item);
    if (!error || error.path !== undefined) continue;

    if (error.type === 'RATE_LIMITED') {
      return {
        kind: 'rateLimited',
        // The 200 still carries the budget headers, so the reset time is knowable.
        resetAt: resetFromHeaders(headers),
        message: 'The GitHub rate limit for this token is exhausted.',
      };
    }
    const authByType = error.type === 'UNAUTHORIZED' || error.type === 'FORBIDDEN';
    // The prose match stays as a fallback for a request-level error carrying no
    // recognised type, but it is now reached only by errors that failed the
    // whole request, which is the only place it was ever safe.
    const authByMessage =
      typeof error.message === 'string' &&
      /credential|unauthorized|authentication/i.test(error.message);
    if (authByType || authByMessage) {
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

  const bodyError = errorForBody(body, response.headers);
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
