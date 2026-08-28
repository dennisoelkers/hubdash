import { describe, expect, it } from 'vitest';
import { parsePrUrl } from './parseUrl';

function expectOk(input: string) {
  const result = parsePrUrl(input);
  if (!result.ok) {
    throw new Error(`expected "${input}" to parse, got: ${result.error}`);
  }
  return result.value;
}

function expectError(input: string) {
  const result = parsePrUrl(input);
  if (result.ok) {
    throw new Error(`expected "${input}" to fail, got: ${JSON.stringify(result.value)}`);
  }
  return result.error;
}

describe('parsePrUrl accepted forms', () => {
  const expected = { owner: 'Example', repo: 'example-server', number: 4821 };

  it('parses a plain PR URL', () => {
    expect(expectOk('https://github.com/Example/example-server/pull/4821')).toEqual(expected);
  });

  it('parses a URL with a trailing slash', () => {
    expect(expectOk('https://github.com/Example/example-server/pull/4821/')).toEqual(expected);
  });

  it('parses a URL with a trailing path segment', () => {
    expect(expectOk('https://github.com/Example/example-server/pull/4821/files')).toEqual(expected);
    expect(expectOk('https://github.com/Example/example-server/pull/4821/commits')).toEqual(expected);
  });

  it('parses a URL with a fragment', () => {
    expect(
      expectOk('https://github.com/Example/example-server/pull/4821#discussion_r123456'),
    ).toEqual(expected);
  });

  it('parses a URL with a purely numeric fragment from its path, not as shorthand', () => {
    // Regression: a looser shorthand regex matched this whole string and
    // returned owner "https:" with a garbage repo instead of parsing the path.
    expect(
      expectOk('https://github.com/Example/example-server/pull/4821#12345'),
    ).toEqual(expected);
  });

  it('parses a URL with a query string', () => {
    expect(
      expectOk('https://github.com/Example/example-server/pull/4821?w=1'),
    ).toEqual(expected);
  });

  it('parses http as well as https', () => {
    expect(expectOk('http://github.com/Example/example-server/pull/4821')).toEqual(expected);
  });

  it('parses the owner/repo#number shorthand', () => {
    expect(expectOk('Example/example-server#4821')).toEqual(expected);
  });

  it('ignores surrounding whitespace and newlines', () => {
    expect(expectOk('  https://github.com/Example/example-server/pull/4821\n')).toEqual(expected);
  });

  it('preserves owner and repo casing as given', () => {
    // prKey does the case-folding; the parser must not silently rewrite input.
    expect(expectOk('https://github.com/EXAMPLE/Server/pull/7').owner).toBe('EXAMPLE');
  });
});

describe('parsePrUrl rejections', () => {
  it('rejects empty and whitespace-only input', () => {
    expect(expectError('')).toMatch(/empty/i);
    expect(expectError('   ')).toMatch(/empty/i);
  });

  it('rejects a non-GitHub host', () => {
    expect(expectError('https://gitlab.com/Example/example-server/pull/4821')).toMatch(
      /github\.com/i,
    );
  });

  it('rejects an issue URL', () => {
    expect(expectError('https://github.com/Example/example-server/issues/4821')).toMatch(
      /pull request/i,
    );
  });

  it('rejects a repo URL with no PR number', () => {
    expect(expectError('https://github.com/Example/example-server')).toMatch(/pull request/i);
    expect(expectError('https://github.com/Example/example-server/pull')).toMatch(/number/i);
  });

  it('rejects a non-numeric PR number', () => {
    expect(expectError('https://github.com/Example/example-server/pull/abc')).toMatch(/number/i);
  });

  it('rejects a zero or negative PR number', () => {
    expect(expectError('https://github.com/Example/example-server/pull/0')).toMatch(/number/i);
    expect(expectError('Example/example-server#0')).toMatch(/number/i);
  });

  it('rejects the repo#number shorthand without an owner', () => {
    expect(expectError('example-server#4821')).toMatch(/owner/i);
  });

  it('rejects a path-like string that merely resembles owner/repo#number', () => {
    expect(expectError('docs/superpowers/plans/hubdash.md#42')).toBeTruthy();
  });

  it('rejects arbitrary text', () => {
    expect(expectError('lunch at one?')).toBeTruthy();
  });
});
