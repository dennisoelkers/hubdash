import { describe, expect, it } from 'vitest';
import { prKey } from './prKey';

describe('prKey', () => {
  it('joins owner, repo and number into a canonical string', () => {
    expect(prKey('Graylog2', 'graylog2-server', 4821)).toBe(
      'graylog2/graylog2-server#4821',
    );
  });

  it('lowercases owner and repo so casing differences do not duplicate', () => {
    expect(prKey('GRAYLOG2', 'Graylog2-Server', 1)).toBe(
      prKey('graylog2', 'graylog2-server', 1),
    );
  });

  it('distinguishes different numbers in the same repo', () => {
    expect(prKey('a', 'b', 1)).not.toBe(prKey('a', 'b', 2));
  });
});
