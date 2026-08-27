import { describe, expect, it } from 'vitest';
import { firstUri, textFrom } from './dropText';

function dataTransfer(types: Record<string, string>): DataTransfer {
  return {
    types: Object.keys(types),
    getData: (type: string) => types[type] ?? '',
  } as unknown as DataTransfer;
}

describe('firstUri', () => {
  it('returns the single line unchanged', () => {
    expect(firstUri('https://github.com/a/b/pull/1')).toBe('https://github.com/a/b/pull/1');
  });

  it('skips comment lines starting with #', () => {
    expect(firstUri('# a comment\nhttps://github.com/a/b/pull/1\n')).toBe(
      'https://github.com/a/b/pull/1',
    );
  });

  it('returns empty for an all-comment or blank payload', () => {
    expect(firstUri('# only a comment')).toBe('');
    expect(firstUri('   \n  ')).toBe('');
  });
});

describe('textFrom', () => {
  it('prefers text/uri-list over text/plain', () => {
    expect(
      textFrom(dataTransfer({ 'text/uri-list': 'https://a/1', 'text/plain': 'something else' })),
    ).toBe('https://a/1');
  });

  it('falls back to text/plain', () => {
    expect(textFrom(dataTransfer({ 'text/plain': 'https://a/2' }))).toBe('https://a/2');
  });

  it('trims text/plain', () => {
    expect(textFrom(dataTransfer({ 'text/plain': '  https://a/3  ' }))).toBe('https://a/3');
  });

  it('returns empty for a null or undefined transfer', () => {
    expect(textFrom(null)).toBe('');
    expect(textFrom(undefined)).toBe('');
  });

  it('returns empty when both fields are empty', () => {
    expect(textFrom(dataTransfer({}))).toBe('');
  });
});
