import { describe, expect, it } from 'vitest';
import type { NormalisedIssue } from '../types';
import { classifyIssue } from './classifyIssue';

function makeIssue(overrides: Partial<NormalisedIssue> = {}): NormalisedIssue {
  return {
    key: 'example/example-server#55',
    owner: 'Example',
    repo: 'example-server',
    number: 55,
    title: 'Sort order is wrong on empty input',
    url: 'https://github.com/Example/example-server/issues/55',
    author: 'octocat',
    nameWithOwner: 'Example/example-server',
    updatedAt: '2026-08-27T10:00:00Z',
    lifecycle: 'OPEN',
    ...overrides,
  };
}

describe('classifyIssue', () => {
  it('classifies an open issue as waiting', () => {
    expect(classifyIssue(makeIssue({ lifecycle: 'OPEN' }))).toBe('waiting');
  });

  it('classifies a closed issue as archive', () => {
    expect(classifyIssue(makeIssue({ lifecycle: 'CLOSED' }))).toBe('archive');
  });
});
