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
  owner: 'Example',
  repo: 'example-server',
  number: 4821,
  addedAt: '2026-08-27T09:00:00Z',
};

describe('loadTrackedPrs', () => {
  it('returns an empty list and no archived keys when the key is absent', () => {
    expect(loadTrackedPrs(fakeStorage())).toEqual({ prs: [], archivedKeys: [], error: null });
  });

  it('round-trips a saved list and its archived keys', () => {
    const storage = fakeStorage();
    saveTrackedPrs([pr], ['example/example-server#4821'], storage);
    expect(loadTrackedPrs(storage)).toEqual({
      prs: [pr],
      archivedKeys: ['example/example-server#4821'],
      error: null,
    });
  });

  it('loads a version-1 payload, defaulting archivedKeys to empty', () => {
    const raw = JSON.stringify({ version: 1, prs: [pr] });
    expect(loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: raw }))).toEqual({
      prs: [pr],
      archivedKeys: [],
      error: null,
    });
  });

  it('reports an error and returns the default for non-JSON', () => {
    const result = loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: 'not json{' }));
    expect(result.prs).toEqual([]);
    expect(result.archivedKeys).toEqual([]);
    expect(result.error).toMatch(/could not be read/i);
  });

  it('rejects a wrong-shaped envelope', () => {
    expect(loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: '[]' })).error).toBeTruthy();
    expect(loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: '{"prs":[]}' })).error).toBeTruthy();
    expect(loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: '{"version":1}' })).error).toBeTruthy();
  });

  it('does not blame the version when the envelope has none', () => {
    const raw = JSON.stringify({ prs: [pr] });
    const error = loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: raw })).error;
    expect(error).toBeTruthy();
    expect(error).not.toMatch(/version/i);
  });

  it('rejects an unknown version', () => {
    const raw = JSON.stringify({ version: 99, prs: [pr], archivedKeys: [] });
    expect(loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: raw })).error).toMatch(/version/i);
  });

  it('rejects entries with missing or wrongly typed fields', () => {
    const bad = [
      { owner: 'a', repo: 'b', number: 1 },
      { owner: 'a', repo: 'b', number: '1', addedAt: 'x' },
      { owner: '', repo: 'b', number: 1, addedAt: 'x' },
      { owner: 'a', repo: 'b', number: 0, addedAt: 'x' },
      { owner: 'a', repo: 'b', number: 1.5, addedAt: 'x' },
    ];
    for (const entry of bad) {
      const raw = JSON.stringify({ version: 1, prs: [entry] });
      const result = loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: raw }));
      expect(result.prs, JSON.stringify(entry)).toEqual([]);
      expect(result.error, JSON.stringify(entry)).toBeTruthy();
    }
  });

  it('rejects a version-2 payload whose archivedKeys is not a string array', () => {
    const raw = JSON.stringify({ version: 2, prs: [pr], archivedKeys: [1, 2] });
    const result = loadTrackedPrs(fakeStorage({ [TRACKED_PRS_KEY]: raw }));
    expect(result.prs).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it('preserves an unusable value under the corrupt key so nothing is lost', () => {
    const storage = fakeStorage({ [TRACKED_PRS_KEY]: 'not json{' });
    loadTrackedPrs(storage);
    expect(storage.getItem(CORRUPT_TRACKED_PRS_KEY)).toBe('not json{');
  });

  it('never throws when storage itself is unavailable', () => {
    expect(loadTrackedPrs(null)).toEqual({ prs: [], archivedKeys: [], error: null });
  });
});

describe('saveTrackedPrs', () => {
  it('writes a versioned envelope with both fields', () => {
    const storage = fakeStorage();
    saveTrackedPrs([pr], ['example/example-server#4821'], storage);
    expect(JSON.parse(storage.getItem(TRACKED_PRS_KEY) ?? '')).toEqual({
      version: 2,
      prs: [pr],
      archivedKeys: ['example/example-server#4821'],
    });
  });

  it('never throws when storage is unavailable', () => {
    expect(() => saveTrackedPrs([pr], [], null)).not.toThrow();
  });
});
