/** A PR the user has chosen to track. This is the only shape persisted. */
export type TrackedPr = {
  owner: string;
  repo: string;
  number: number;
  /** ISO 8601 timestamp of when it was added to the board. */
  addedAt: string;
};

/** Canonical identity, e.g. "example/example-server#4821". Lowercased. */
export type PrKey = string;

/** Normalised CI outcome. `none` means the PR has no checks at all. */
export type CiState = 'success' | 'failure' | 'pending' | 'none';

/** GitHub's `reviewDecision`. `null` means the repo requires no review. */
export type ReviewDecision =
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'REVIEW_REQUIRED'
  | null;

/** GitHub's `mergeable`. `UNKNOWN` means "still being computed". */
export type MergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';

export type PrLifecycle = 'OPEN' | 'CLOSED' | 'MERGED';

/** A PR after normalisation. Everything the UI needs, nothing raw. */
export type NormalisedPr = {
  key: PrKey;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  nameWithOwner: string;
  baseRefName: string;
  updatedAt: string;
  lifecycle: PrLifecycle;
  isDraft: boolean;
  reviewDecision: ReviewDecision;
  mergeable: MergeableState;
  ci: CiState;
  /** Failing contexts actually seen; may undercount past 100 (spec §5.2). */
  failingCheckCount: number;
  approvalCount: number;
  requestedReviewerCount: number;
};

export type ColumnId = 'waiting' | 'needsAction' | 'ready' | 'archive';

export type BadgeKind =
  | 'merged'
  | 'closed'
  | 'draft'
  | 'conflicts'
  | 'changesRequested'
  | 'approved'
  | 'approvalCount'
  | 'reviewersRequested'
  | 'failingChecks'
  | 'ciRunning'
  | 'ciGreen';

export type BadgeTone = 'neutral' | 'good' | 'bad' | 'warn';

export type Badge = {
  kind: BadgeKind;
  label: string;
  tone: BadgeTone;
};

/**
 * One entry on the board. A tracked PR either resolved to data, or failed to
 * resolve on its own (deleted, renamed, no access) without affecting others.
 */
export type PrEntry =
  | { status: 'ok'; key: PrKey; tracked: TrackedPr; pr: NormalisedPr }
  | { status: 'error'; key: PrKey; tracked: TrackedPr; message: string };

export type RateLimit = {
  limit: number;
  cost: number;
  remaining: number;
  resetAt: string;
};

export type PollResult = {
  entries: PrEntry[];
  rateLimit: RateLimit | null;
};

/** A failure of the request as a whole, as opposed to one PR failing. */
export type TransportError =
  | { kind: 'network'; message: string }
  | { kind: 'auth'; message: string }
  | { kind: 'rateLimited'; resetAt: string | null; message: string }
  | { kind: 'server'; status: number; message: string }
  | { kind: 'malformed'; message: string };

export type FetchOutcome =
  | { ok: true; result: PollResult }
  | { ok: false; error: TransportError };

/** One target version of a backport group, and the PR filling it (if any). */
export type BackportSlot = {
  /** Free-text version label exactly as the user typed it, e.g. "6.2". */
  version: string;
  /** The backport PR filling this slot, or null while the slot is empty. */
  pr: TrackedPr | null;
};

/**
 * A change and everywhere it still has to land. Identified by its main PR's
 * `prKey` — there is no generated id, so identity follows the codebase's one
 * canonical key format and duplicate detection comes for free.
 */
export type BackportGroup = {
  main: TrackedPr;
  slots: BackportSlot[];
  /** ISO 8601, when the group was created. */
  addedAt: string;
  /** Set only by the user's own Archive action; never implied by isComplete. */
  archived: boolean;
};

/**
 * Merge status of one slot. This tab tracks nothing else — no CI, no review.
 * `pending` means a PR is set but no poll has returned for it yet; claiming
 * `open` there would assert something we do not know.
 */
export type SlotState =
  | { kind: 'empty' }
  | { kind: 'pending' }
  | { kind: 'errored'; message: string }
  | { kind: 'open' }
  | { kind: 'merged' }
  | { kind: 'closed' };
