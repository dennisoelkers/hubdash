import { describe, expect, it } from 'vitest';
import { makePr } from '../test/makePr';
import { classify } from './classify';

describe('classify — lifecycle (rule 1)', () => {
  it('archives a merged PR', () => {
    expect(classify(makePr({ lifecycle: 'MERGED' }))).toBe('archive');
  });

  it('archives a closed, unmerged PR', () => {
    expect(classify(makePr({ lifecycle: 'CLOSED' }))).toBe('archive');
  });

  it('archives regardless of any other signal', () => {
    expect(
      classify(makePr({ lifecycle: 'MERGED', ci: 'failure', mergeable: 'CONFLICTING' })),
    ).toBe('archive');
  });
});

describe('classify — CI (rule 2)', () => {
  it('sends failing CI to needs action', () => {
    expect(classify(makePr({ ci: 'failure' }))).toBe('needsAction');
  });

  it('leaves pending CI in waiting', () => {
    expect(classify(makePr({ ci: 'pending' }))).toBe('waiting');
  });
});

describe('classify — conflicts (rule 3)', () => {
  it('sends a conflicting PR to needs action', () => {
    expect(classify(makePr({ mergeable: 'CONFLICTING' }))).toBe('needsAction');
  });

  it('does NOT treat UNKNOWN mergeability as a conflict', () => {
    // GitHub computes `mergeable` asynchronously; UNKNOWN must never move a
    // card to needs action, or every freshly pushed PR flickers red.
    expect(classify(makePr({ mergeable: 'UNKNOWN' }))).toBe('waiting');
  });

  it('does not block Ready on UNKNOWN mergeability', () => {
    expect(
      classify(makePr({ mergeable: 'UNKNOWN', reviewDecision: 'APPROVED', ci: 'success' })),
    ).toBe('ready');
  });
});

describe('classify — review decision (rule 4)', () => {
  it('sends changes requested to needs action', () => {
    expect(classify(makePr({ reviewDecision: 'CHANGES_REQUESTED' }))).toBe('needsAction');
  });

  it('leaves review required in waiting', () => {
    expect(classify(makePr({ reviewDecision: 'REVIEW_REQUIRED' }))).toBe('waiting');
  });
});

describe('classify — drafts (rule 5)', () => {
  it('sends a draft to needs action', () => {
    expect(classify(makePr({ isDraft: true }))).toBe('needsAction');
  });

  it('sends a draft with failing CI to needs action', () => {
    expect(classify(makePr({ isDraft: true, ci: 'failure' }))).toBe('needsAction');
  });

  it('does not let an approved draft reach ready', () => {
    expect(classify(makePr({ isDraft: true, reviewDecision: 'APPROVED' }))).toBe('needsAction');
  });
});

describe('classify — ready (rule 6)', () => {
  it('is ready when approved and green', () => {
    expect(classify(makePr({ reviewDecision: 'APPROVED', ci: 'success' }))).toBe('ready');
  });

  it('is ready when approved and the repo has no checks at all', () => {
    // Without this branch an approved PR in a CI-less repo waits forever.
    expect(classify(makePr({ reviewDecision: 'APPROVED', ci: 'none' }))).toBe('ready');
  });

  it('is NOT ready when approved but failing', () => {
    expect(classify(makePr({ reviewDecision: 'APPROVED', ci: 'failure' }))).toBe('needsAction');
  });

  it('is NOT ready when approved but conflicting', () => {
    expect(
      classify(makePr({ reviewDecision: 'APPROVED', mergeable: 'CONFLICTING' })),
    ).toBe('needsAction');
  });

  it('is NOT ready when approved but CI is still running', () => {
    expect(classify(makePr({ reviewDecision: 'APPROVED', ci: 'pending' }))).toBe('waiting');
  });
});

describe('classify — fallthrough (rule 7)', () => {
  it('waits on an unreviewed green PR', () => {
    expect(classify(makePr())).toBe('waiting');
  });

  it('waits when the repo requires no review and CI is green', () => {
    // reviewDecision null is not a synonym for APPROVED, so this is not ready.
    expect(classify(makePr({ reviewDecision: null, ci: 'success' }))).toBe('waiting');
  });

  it('waits when there are no checks and no approval', () => {
    expect(classify(makePr({ ci: 'none' }))).toBe('waiting');
  });
});
