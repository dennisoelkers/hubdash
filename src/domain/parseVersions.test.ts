import { describe, expect, it } from 'vitest';
import { parseVersions } from './parseVersions';

describe('parseVersions', () => {
  it('splits a comma-separated list', () => {
    expect(parseVersions('6.2,6.1,6.0')).toEqual(['6.2', '6.1', '6.0']);
  });

  it('trims surrounding whitespace on each part', () => {
    expect(parseVersions(' 6.2 ,  6.1,6.0 ')).toEqual(['6.2', '6.1', '6.0']);
  });

  it('drops empty parts rather than producing blank versions', () => {
    expect(parseVersions('6.2,,6.1,')).toEqual(['6.2', '6.1']);
  });

  it('removes duplicates, keeping the first occurrence', () => {
    expect(parseVersions('6.2,6.1,6.2')).toEqual(['6.2', '6.1']);
  });

  it('preserves the order given rather than sorting', () => {
    // Version schemes vary; a wrong sort is worse than the user's own order.
    expect(parseVersions('5.2, 6.0, 6.1')).toEqual(['5.2', '6.0', '6.1']);
  });

  it('returns an empty list for input that parses to nothing', () => {
    expect(parseVersions('')).toEqual([]);
    expect(parseVersions('   ')).toEqual([]);
    expect(parseVersions(',,,')).toEqual([]);
  });

  it('accepts labels that are not dotted numbers', () => {
    expect(parseVersions('main, release/6.2, hotfix')).toEqual(['main', 'release/6.2', 'hotfix']);
  });
});
