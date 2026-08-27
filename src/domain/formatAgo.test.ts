import { describe, expect, it } from 'vitest';
import { formatAgo } from './formatAgo';

const base = Date.parse('2026-08-27T12:00:00Z');

function ago(seconds: number): string {
  return formatAgo(new Date(base - seconds * 1000).toISOString(), base);
}

describe('formatAgo', () => {
  it('says "just now" for the first few seconds', () => {
    expect(ago(0)).toBe('just now');
    expect(ago(4)).toBe('just now');
  });

  it('counts seconds under a minute', () => {
    expect(ago(5)).toBe('5s ago');
    expect(ago(59)).toBe('59s ago');
  });

  it('counts whole minutes under an hour', () => {
    expect(ago(60)).toBe('1m ago');
    expect(ago(125)).toBe('2m ago');
    expect(ago(3599)).toBe('59m ago');
  });

  it('counts whole hours beyond that', () => {
    expect(ago(3600)).toBe('1h ago');
    expect(ago(7200 + 60)).toBe('2h ago');
  });

  it('does not go backwards if the clock skews', () => {
    expect(formatAgo(new Date(base + 5000).toISOString(), base)).toBe('just now');
  });

  it('reports an unparseable timestamp rather than NaN', () => {
    expect(formatAgo('not a date', base)).toBe('unknown');
  });
});
