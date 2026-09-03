import { describe, expect, it } from 'vitest';
import { parseTaskUrl } from './parseTaskUrl';

describe('parseTaskUrl — pull requests', () => {
  it('accepts a full PR URL', () => {
    const result = parseTaskUrl('https://github.com/Example/example-server/pull/4821');
    expect(result).toEqual({
      ok: true,
      value: { kind: 'pr', owner: 'Example', repo: 'example-server', number: 4821 },
    });
  });

  it('accepts a PR URL with trailing segments', () => {
    const result = parseTaskUrl('https://github.com/Example/example-server/pull/4821/files');
    expect(result.ok).toBe(true);
  });
});

describe('parseTaskUrl — issues', () => {
  it('accepts a full issue URL', () => {
    const result = parseTaskUrl('https://github.com/Example/example-server/issues/55');
    expect(result).toEqual({
      ok: true,
      value: { kind: 'issue', owner: 'Example', repo: 'example-server', number: 55 },
    });
  });
});

describe('parseTaskUrl — shorthand is rejected', () => {
  it('rejects owner/repo#number with a message naming the reason', () => {
    const result = parseTaskUrl('Example/example-server#55');
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toMatch(/full github link/i);
    expect(result.error).toMatch(/issue or a pull request/i);
  });
});

describe('parseTaskUrl — invalid input', () => {
  it('rejects an empty string', () => {
    expect(parseTaskUrl('').ok).toBe(false);
    expect(parseTaskUrl('   ').ok).toBe(false);
  });

  it('rejects a non-URL string', () => {
    expect(parseTaskUrl('not a url').ok).toBe(false);
  });

  it('rejects a non-github URL', () => {
    const result = parseTaskUrl('https://gitlab.com/a/b/issues/1');
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('github.com');
  });

  it('rejects a bare repository URL', () => {
    const result = parseTaskUrl('https://github.com/Example/example-server');
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toMatch(/repository/i);
  });

  it('rejects a URL pointing at neither pull nor issues', () => {
    const result = parseTaskUrl('https://github.com/Example/example-server/tree/main');
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('tree');
  });

  it('rejects a missing or non-numeric number', () => {
    expect(parseTaskUrl('https://github.com/Example/example-server/pull/').ok).toBe(false);
    expect(parseTaskUrl('https://github.com/Example/example-server/pull/abc').ok).toBe(false);
    expect(parseTaskUrl('https://github.com/Example/example-server/issues/0').ok).toBe(false);
  });

  it('accepts www.github.com', () => {
    const result = parseTaskUrl('https://www.github.com/Example/example-server/pull/1');
    expect(result.ok).toBe(true);
  });

  it('rejects a non-http(s) protocol', () => {
    const result = parseTaskUrl('ftp://github.com/Example/example-server/pull/1');
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toMatch(/http/i);
  });
});
