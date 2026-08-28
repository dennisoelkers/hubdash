import { describe, expect, it } from 'vitest';
import { detectBackportVersions } from './detectBackportVersions';

describe('detectBackportVersions', () => {
  it('extracts backtick-wrapped versions from the exact example phrasing', () => {
    expect(
      detectBackportVersions('This PR needs to be backported to `7.1`, `6.3` & `7.0`.'),
    ).toEqual(['7.1', '6.3', '7.0']);
  });

  it('extracts bare versions with no backticks at all', () => {
    expect(detectBackportVersions('Needs backport to 7.1 and 6.3.')).toEqual(['7.1', '6.3']);
  });

  it('strips a leading v from a version token', () => {
    expect(detectBackportVersions('Backport to v7.1 please.')).toEqual(['7.1']);
  });

  it('supports a three-segment version', () => {
    expect(detectBackportVersions('backport to `6.3.0`')).toEqual(['6.3.0']);
  });

  it('collects matches across every matching line, not just the first', () => {
    const body = ['Some unrelated intro line.', 'backport to 7.1', 'also backport to 6.3'].join(
      '\n',
    );
    expect(detectBackportVersions(body)).toEqual(['7.1', '6.3']);
  });

  it('ignores a version-shaped token on a line that does not mention backport', () => {
    const body = ['Bumps a dependency from 1.2 to 1.3.', 'Needs backport to 2.0.'].join('\n');
    expect(detectBackportVersions(body)).toEqual(['2.0']);
  });

  it('returns an empty list when nothing mentions backport', () => {
    expect(detectBackportVersions('Just a regular PR description with no versions.')).toEqual([]);
  });

  it('returns an empty list for an empty body', () => {
    expect(detectBackportVersions('')).toEqual([]);
  });

  it('de-duplicates a version repeated across two matching lines, keeping the first position', () => {
    const body = ['backport to 7.1 and 6.3', 'also needs backport to 6.3'].join('\n');
    expect(detectBackportVersions(body)).toEqual(['7.1', '6.3']);
  });

  it('is case-insensitive about the word "backport"', () => {
    expect(detectBackportVersions('BACKPORT to 7.1')).toEqual(['7.1']);
  });
});
