import { describe, expect, it } from 'vitest';
import type { TrackedPr } from '../types';
import {
  CORRUPT_TRACKED_PRS_KEY,
  TRACKED_PRS_KEY,
  loadTrackedPrs,
  saveTrackedPrs,
} from './trackedPrs';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const pr: TrackedPr = {
  owner: 'Graylog2',
  repo: 'graylog2-server',
  number: 4821,
  addedAt: '2026-08-27T09:00:00Z',
};

describe('loadTrackedPrs', () => {
  it('returns an empty list with no error when the key is absent', () => {
    expect(loadTrackedPrs(fakeStorage())).toEqual({ prs: [], error: null });
  });

  it('round-trips a saved list', () => {
    const storage = fakeStorage();
    saveTrackedPrs([pr], storage);
    expect(loadTrackedPrs(storage)).toEqual({ prs: [pr], error: null });
  });

  it('reports an error and returns the default for non-JSON', () => {
    const result = loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: 'not json{' }));
    expect(result.prs).toEqual([]);
    expect(result.error).toMatch(/could not be read/i);
  });

  it('rejects a wrong-shaped envelope', () => {
    expect(loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: '[]' })).error).toBeTruthy();
    expect(loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: '{"prs":[]}' })).error).toBeTruthy();
    expect(loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: '{"version":1}' })).error).toBeTruthy();
  });

  it('does not blame the version when the envelope has none', () => {
    // A payload with no version key at all is a wrong shape, not a future one.
    // Reporting "unsupported version" sends the reader looking for a migration
    // that was never the problem.
    const raw = JSON.stringify({ prs: [pr] });
    const error = loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: raw })).error;
    expect(error).toBeTruthy();
    expect(error).not.toMatch(/version/i);
  });

  it('rejects an unknown version', () => {
    const raw = JSON.stringify({ version: 99, prs: [pr] });
    expect(loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: raw })).error).toMatch(/version/i);
  });

  it('rejects entries with missing or wrongly typed fields', () => {
    const bad = [
      { owner: 'a', repo: 'b', number: 1 }, // no addedAt
      { owner: 'a', repo: 'b', number: '1', addedAt: 'x' }, // number as string
      { owner: '', repo: 'b', number: 1, addedAt: 'x' }, // empty owner
      { owner: 'a', repo: 'b', number: 0, addedAt: 'x' }, // number not positive
      { owner: 'a', repo: 'b', number: 1.5, addedAt: 'x' }, // not an integer
    ];
    for (const entry of bad) {
      const raw = JSON.stringify({ version: 1, prs: [entry] });
      const result = loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: raw }));
      expect(result.prs, JSON.stringify(entry)).toEqual([]);
      expect(result.error, JSON.stringify(entry)).toBeTruthy();
    }
  });

  it('preserves an unusable value under the corrupt key so nothing is lost', () => {
    const storage = fakeStorage({ [TRACKED_PRS_KEY]: 'not json{' });
    loadTrackedPrs(storage);
    expect(storage.getItem(CORRUPT_TRACKED_PRS_KEY)).toBe('not json{');
  });

  it('never throws when storage itself is unavailable', () => {
    expect(loadTrackedPrs(null)).toEqual({ prs: [], error: null });
  });
});

describe('saveTrackedPrs', () => {
  it('writes a versioned envelope', () => {
    const storage = fakeStorage();
    saveTrackedPrs([pr], storage);
    expect(JSON.parse(storage.getItem(TRACKED_PRS_KEY) ?? '')).toEqual({
      version: 1,
      prs: [pr],
    });
  });

  it('never throws when storage is unavailable', () => {
    expect(() => saveTrackedPrs([pr], null)).not.toThrow();
  });
});
