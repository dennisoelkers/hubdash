import { describe, expect, it } from 'vitest';
import { makePr } from '../test/makePr';
import type { BadgeKind } from '../types';
import { badgesFor } from './badges';

function kinds(...args: Parameters<typeof makePr>): BadgeKind[] {
  return badgesFor(makePr(...args)).map((badge) => badge.kind);
}

function labelOf(kind: BadgeKind, ...args: Parameters<typeof makePr>): string {
  const badge = badgesFor(makePr(...args)).find((candidate) => candidate.kind === kind);
  if (!badge) throw new Error(`expected a ${kind} badge`);
  return badge.label;
}

describe('badgesFor', () => {
  it('marks a draft', () => {
    expect(kinds({ isDraft: true })).toContain('draft');
    expect(labelOf('draft', { isDraft: true })).toBe('⊘ draft');
  });

  it('marks conflicts, but not UNKNOWN mergeability', () => {
    expect(kinds({ mergeable: 'CONFLICTING' })).toContain('conflicts');
    expect(kinds({ mergeable: 'UNKNOWN' })).not.toContain('conflicts');
    expect(labelOf('conflicts', { mergeable: 'CONFLICTING' })).toBe('⚠ conflicts');
  });

  it('marks changes requested', () => {
    expect(labelOf('changesRequested', { reviewDecision: 'CHANGES_REQUESTED' })).toBe(
      '✖ changes requested',
    );
  });

  it('marks approval', () => {
    expect(labelOf('approved', { reviewDecision: 'APPROVED' })).toBe('✓✓ approved');
  });

  it('shows an approval count only when the PR is not yet fully approved', () => {
    // "✓✓ approved" plus "2 approvals" would be saying the same thing twice.
    expect(kinds({ reviewDecision: 'APPROVED', approvalCount: 2 })).not.toContain('approvalCount');
    expect(kinds({ reviewDecision: 'REVIEW_REQUIRED', approvalCount: 1 })).toContain(
      'approvalCount',
    );
  });

  it('pluralises the approval count', () => {
    expect(labelOf('approvalCount', { approvalCount: 1 })).toBe('1 approval');
    expect(labelOf('approvalCount', { approvalCount: 2 })).toBe('2 approvals');
  });

  it('omits a zero approval count', () => {
    expect(kinds({ approvalCount: 0 })).not.toContain('approvalCount');
  });

  it('pluralises requested reviewers and omits zero', () => {
    expect(labelOf('reviewersRequested', { requestedReviewerCount: 1 })).toBe(
      '1 reviewer requested',
    );
    expect(labelOf('reviewersRequested', { requestedReviewerCount: 3 })).toBe(
      '3 reviewers requested',
    );
    expect(kinds({ requestedReviewerCount: 0 })).not.toContain('reviewersRequested');
  });

  it('counts failing checks', () => {
    expect(labelOf('failingChecks', { ci: 'failure', failingCheckCount: 2 })).toBe('● 2 failing');
  });

  it('falls back to an uncounted failure when the rollup is red but no context was seen', () => {
    // Happens when a PR has more than the 100 contexts we request (spec §5.2).
    expect(labelOf('failingChecks', { ci: 'failure', failingCheckCount: 0 })).toBe(
      '● build failing',
    );
  });

  it('marks CI running and CI green', () => {
    expect(labelOf('ciRunning', { ci: 'pending' })).toBe('◌ CI running');
    expect(labelOf('ciGreen', { ci: 'success' })).toBe('✓ green');
  });

  it('shows no CI badge at all when the repo has no checks', () => {
    expect(kinds({ ci: 'none' })).not.toContain('ciGreen');
    expect(kinds({ ci: 'none' })).not.toContain('ciRunning');
    expect(kinds({ ci: 'none' })).not.toContain('failingChecks');
  });

  it('marks merged and closed', () => {
    expect(labelOf('merged', { lifecycle: 'MERGED' })).toBe('⊙ merged');
    expect(labelOf('closed', { lifecycle: 'CLOSED' })).toBe('⊗ closed');
  });

  it('returns badges in a stable, documented order', () => {
    const all = kinds({
      lifecycle: 'MERGED',
      isDraft: true,
      mergeable: 'CONFLICTING',
      reviewDecision: 'CHANGES_REQUESTED',
      requestedReviewerCount: 1,
      approvalCount: 1,
      ci: 'failure',
      failingCheckCount: 3,
    });
    expect(all).toEqual([
      'merged',
      'draft',
      'conflicts',
      'changesRequested',
      'approvalCount',
      'reviewersRequested',
      'failingChecks',
    ]);
  });

  it('assigns tones that match severity', () => {
    const tone = (pr: Parameters<typeof makePr>[0], kind: BadgeKind) =>
      badgesFor(makePr(pr)).find((badge) => badge.kind === kind)?.tone;
    expect(tone({ ci: 'failure', failingCheckCount: 1 }, 'failingChecks')).toBe('bad');
    expect(tone({ mergeable: 'CONFLICTING' }, 'conflicts')).toBe('bad');
    expect(tone({ reviewDecision: 'CHANGES_REQUESTED' }, 'changesRequested')).toBe('bad');
    expect(tone({ reviewDecision: 'APPROVED' }, 'approved')).toBe('good');
    expect(tone({ ci: 'success' }, 'ciGreen')).toBe('good');
    expect(tone({ ci: 'pending' }, 'ciRunning')).toBe('warn');
    expect(tone({ isDraft: true }, 'draft')).toBe('neutral');
  });
});
