import { describe, expect, it } from 'vitest';
import { prKey } from './prKey';

describe('prKey', () => {
  it('joins owner, repo and number into a canonical string', () => {
    expect(prKey('Example', 'example-server', 4821)).toBe('example/example-server#4821');
  });

  it('lowercases owner and repo so casing differences do not duplicate', () => {
    expect(prKey('EXAMPLE', 'Example-Server', 1)).toBe(prKey('example', 'example-server', 1));
  });

  it('distinguishes different numbers in the same repo', () => {
    expect(prKey('a', 'b', 1)).not.toBe(prKey('a', 'b', 2));
  });
});
