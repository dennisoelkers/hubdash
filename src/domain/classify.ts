import type { ColumnId, NormalisedPr } from '../types';

/**
 * Which column a PR belongs in, per spec §6. Rules are evaluated in order and
 * the first match wins, so the most blocking reason decides the column.
 *
 * The columns answer one question — whose move is it:
 *   needsAction  mine: broken, changes requested, or an unfinished draft
 *   waiting      someone else's: no review yet, or CI still running
 *   ready        approved and green; nothing stands in the way
 */
export function classify(pr: NormalisedPr): ColumnId {
  if (pr.lifecycle === 'MERGED' || pr.lifecycle === 'CLOSED') return 'archive';

  if (pr.ci === 'failure') return 'needsAction';

  // Only CONFLICTING blocks. UNKNOWN means GitHub has not finished computing
  // mergeability yet and must not be read as a conflict.
  if (pr.mergeable === 'CONFLICTING') return 'needsAction';

  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'needsAction';

  // Nobody else can act on a draft, so it is always the author's move.
  if (pr.isDraft) return 'needsAction';

  // `ci === 'none'` is accepted: a repo without CI must still reach ready.
  if (pr.reviewDecision === 'APPROVED' && (pr.ci === 'success' || pr.ci === 'none')) {
    return 'ready';
  }

  return 'waiting';
}
