import type { ColumnId, NormalisedPr } from '../types';

/**
 * Which column a PR belongs in, per spec §6. Rules are evaluated in order and
 * the first match wins, so the most blocking reason decides the column.
 *
 * The columns answer one question — whose move is it:
 *   needsAction  mine: broken, changes requested (and not yet re-requested),
 *                or an unfinished draft
 *   waiting      someone else's: no review yet, CI still running, or changes
 *                requested but a review has been re-requested
 *   ready        approved and green; nothing stands in the way
 */
export function classify(pr: NormalisedPr): ColumnId {
  if (pr.lifecycle === 'MERGED' || pr.lifecycle === 'CLOSED') return 'archive';

  if (pr.ci === 'failure') return 'needsAction';

  // Only CONFLICTING blocks. UNKNOWN means GitHub has not finished computing
  // mergeability yet and must not be read as a conflict.
  if (pr.mergeable === 'CONFLICTING') return 'needsAction';

  // GitHub's reviewDecision does not clear itself on a push or a re-request —
  // only a new review submission changes it. A pending review request is the
  // signal that the ball has moved back to the reviewer.
  if (pr.reviewDecision === 'CHANGES_REQUESTED' && pr.requestedReviewerCount === 0) {
    return 'needsAction';
  }

  // Nobody else can act on a draft, so it is always the author's move.
  if (pr.isDraft) return 'needsAction';

  // `ci === 'none'` is accepted: a repo without CI must still reach ready.
  if (pr.reviewDecision === 'APPROVED' && (pr.ci === 'success' || pr.ci === 'none')) {
    return 'ready';
  }

  return 'waiting';
}
