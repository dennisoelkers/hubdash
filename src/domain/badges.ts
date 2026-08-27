import type { Badge, NormalisedPr } from '../types';

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/**
 * The evidence behind a card's column, per spec §6.1. Additive — a card can
 * carry several — and emitted in a fixed order so the UI never reshuffles.
 *
 * There is deliberately no "N of M approvals" badge: the required-approval
 * count lives in branch protection, which the board query does not fetch.
 */
export function badgesFor(pr: NormalisedPr): Badge[] {
  const badges: Badge[] = [];

  if (pr.lifecycle === 'MERGED') {
    badges.push({ kind: 'merged', label: '⊙ merged', tone: 'good' });
  }
  if (pr.lifecycle === 'CLOSED') {
    badges.push({ kind: 'closed', label: '⊗ closed', tone: 'neutral' });
  }
  if (pr.isDraft) {
    badges.push({ kind: 'draft', label: '⊘ draft', tone: 'neutral' });
  }
  if (pr.mergeable === 'CONFLICTING') {
    badges.push({ kind: 'conflicts', label: '⚠ conflicts', tone: 'bad' });
  }
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    badges.push({ kind: 'changesRequested', label: '✖ changes requested', tone: 'bad' });
  }
  if (pr.reviewDecision === 'APPROVED') {
    badges.push({ kind: 'approved', label: '✓✓ approved', tone: 'good' });
  } else if (pr.approvalCount > 0) {
    badges.push({
      kind: 'approvalCount',
      label: plural(pr.approvalCount, 'approval'),
      tone: 'neutral',
    });
  }
  if (pr.requestedReviewerCount > 0) {
    badges.push({
      kind: 'reviewersRequested',
      label: `${plural(pr.requestedReviewerCount, 'reviewer')} requested`,
      tone: 'neutral',
    });
  }

  switch (pr.ci) {
    case 'failure':
      badges.push({
        kind: 'failingChecks',
        // A red rollup with no failing context means the failure is past the
        // 100-context window we request, so report it without a count.
        label: pr.failingCheckCount > 0 ? `● ${pr.failingCheckCount} failing` : '● build failing',
        tone: 'bad',
      });
      break;
    case 'pending':
      badges.push({ kind: 'ciRunning', label: '◌ CI running', tone: 'warn' });
      break;
    case 'success':
      badges.push({ kind: 'ciGreen', label: '✓ green', tone: 'good' });
      break;
    case 'none':
      break;
  }

  return badges;
}
