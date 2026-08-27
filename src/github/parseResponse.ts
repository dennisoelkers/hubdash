import { prKey } from '../domain/prKey';
import type {
  CiState,
  MergeableState,
  NormalisedPr,
  PollResult,
  PrEntry,
  PrLifecycle,
  RateLimit,
  ReviewDecision,
  TrackedPr,
} from '../types';
import { aliasFor } from './buildQuery';

export type ParseResponseResult =
  | { ok: true; result: PollResult }
  | { ok: false; error: string };

const FAILING_CONCLUSIONS = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'STARTUP_FAILURE',
  'ACTION_REQUIRED',
]);
const FAILING_STATES = new Set(['FAILURE', 'ERROR']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asLifecycle(value: unknown): PrLifecycle {
  return value === 'MERGED' || value === 'CLOSED' ? value : 'OPEN';
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
    byAlias.set(alias, asString(error.message, 'This pull request could not be loaded.'));
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

/**
 * Turns one board response into entries, one per tracked PR in tracked order.
 * A PR that failed on its own becomes an errored entry; only a payload with no
 * usable `data` fails the whole poll.
 */
export function parseResponse(raw: unknown, prs: TrackedPr[]): ParseResponseResult {
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

  const entries: PrEntry[] = prs.map((tracked, index) => {
    const alias = aliasFor(index);
    const key = prKey(tracked.owner, tracked.repo, tracked.number);
    const repository = asRecord(data[alias]);
    const node = asRecord(repository?.pullRequest);

    if (!node) {
      return {
        status: 'error',
        key,
        tracked,
        message:
          aliasErrors.get(alias) ??
          'This pull request could not be loaded. It may have been deleted, or the token may not have access.',
      };
    }

    return { status: 'ok', key, tracked, pr: normalisePr(node, tracked) };
  });

  return { ok: true, result: { entries, rateLimit: normaliseRateLimit(data.rateLimit) } };
}
