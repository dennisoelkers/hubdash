import { describe, expect, it } from 'vitest';
import type { BackportGroup } from '../types';
import {
  BACKPORT_GROUPS_KEY,
  CORRUPT_BACKPORT_GROUPS_KEY,
  loadBackportGroups,
  saveBackportGroups,
} from './backportGroups';

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

const group: BackportGroup = {
  main: { owner: 'Example', repo: 'example-server', number: 4821, addedAt: '2026-08-01T00:00:00Z' },
  slots: [
    {
      version: '6.2',
      pr: {
        owner: 'Example',
        repo: 'example-server',
        number: 4840,
        addedAt: '2026-08-02T00:00:00Z',
      },
    },
    { version: '6.1', pr: null },
  ],
  addedAt: '2026-08-20T00:00:00Z',
  archived: false,
};

function stored(groups: unknown, version: unknown = 2): Record<string, string> {
  return { [BACKPORT_GROUPS_KEY]: JSON.stringify({ version, groups }) };
}

describe('loadBackportGroups', () => {
  it('returns an empty list with no error when the key is absent', () => {
    expect(loadBackportGroups(fakeStorage())).toEqual({ groups: [], error: null });
  });

  it('round-trips a saved list, including a null slot', () => {
    const storage = fakeStorage();
    saveBackportGroups([group], storage);
    expect(loadBackportGroups(storage)).toEqual({ groups: [group], error: null });
  });

  it('reports an error and returns the default for non-JSON', () => {
    const result = loadBackportGroups(fakeStorage({ [BACKPORT_GROUPS_KEY]: 'not json{' }));
    expect(result.groups).toEqual([]);
    expect(result.error).toMatch(/could not be read/i);
  });

  it('rejects a wrong-shaped envelope', () => {
    expect(loadBackportGroups(fakeStorage({ [BACKPORT_GROUPS_KEY]: '[]' })).error).toBeTruthy();
    expect(
      loadBackportGroups(fakeStorage({ [BACKPORT_GROUPS_KEY]: '{"groups":[]}' })).error,
    ).toBeTruthy();
  });

  it('reports a wrong shape rather than a version problem when version is absent', () => {
    const raw = JSON.stringify({ groups: [] });
    expect(loadBackportGroups(fakeStorage({ [BACKPORT_GROUPS_KEY]: raw })).error).toMatch(
      /could not be read/i,
    );
  });

  it('rejects an unknown version', () => {
    expect(loadBackportGroups(fakeStorage(stored([group], 99))).error).toMatch(/version/i);
  });

  it('rejects a group whose main PR is malformed', () => {
    const bad = { ...group, main: { owner: 'a', repo: 'b', number: 0, addedAt: 'x' } };
    expect(loadBackportGroups(fakeStorage(stored([bad]))).groups).toEqual([]);
    expect(loadBackportGroups(fakeStorage(stored([bad]))).error).toBeTruthy();
  });

  it('rejects a group whose slots are not an array', () => {
    const bad = { ...group, slots: 'nope' };
    expect(loadBackportGroups(fakeStorage(stored([bad]))).error).toBeTruthy();
  });

  it('rejects a slot with an empty or non-string version', () => {
    for (const version of ['', 42, null]) {
      const bad = { ...group, slots: [{ version, pr: null }] };
      expect(loadBackportGroups(fakeStorage(stored([bad]))).error, String(version)).toBeTruthy();
    }
  });

  it('rejects a slot whose pr is present but malformed', () => {
    const bad = { ...group, slots: [{ version: '6.2', pr: { owner: 'a' } }] };
    expect(loadBackportGroups(fakeStorage(stored([bad]))).error).toBeTruthy();
  });

  it('accepts a group with no slots', () => {
    const empty = { ...group, slots: [] };
    expect(loadBackportGroups(fakeStorage(stored([empty])))).toEqual({
      groups: [empty],
      error: null,
    });
  });

  it('preserves an unusable value under the corrupt key so nothing is lost', () => {
    const storage = fakeStorage({ [BACKPORT_GROUPS_KEY]: 'not json{' });
    loadBackportGroups(storage);
    expect(storage.getItem(CORRUPT_BACKPORT_GROUPS_KEY)).toBe('not json{');
  });

  it('never throws when storage is unavailable', () => {
    expect(loadBackportGroups(null)).toEqual({ groups: [], error: null });
  });

  it('migrates a version-1 payload, defaulting archived to false on every group', () => {
    const legacyGroup = {
      main: group.main,
      slots: group.slots,
      addedAt: group.addedAt,
    };
    const storage = fakeStorage(stored([legacyGroup], 1));
    expect(loadBackportGroups(storage)).toEqual({
      groups: [{ ...legacyGroup, archived: false }],
      error: null,
    });
  });

  it('round-trips a version-2 group whose archived is true', () => {
    const storage = fakeStorage();
    saveBackportGroups([{ ...group, archived: true }], storage);
    expect(loadBackportGroups(storage)).toEqual({
      groups: [{ ...group, archived: true }],
      error: null,
    });
  });

  it('rejects a version-2 group missing archived', () => {
    const bad = { main: group.main, slots: group.slots, addedAt: group.addedAt };
    const result = loadBackportGroups(fakeStorage(stored([bad], 2)));
    expect(result.groups).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it('rejects a version-1 payload whose groups do not match the legacy shape', () => {
    const bad = {
      main: { owner: 'a', repo: 'b', number: 0, addedAt: 'x' },
      slots: [],
      addedAt: '2026-08-01T00:00:00Z',
    };
    const result = loadBackportGroups(fakeStorage(stored([bad], 1)));
    expect(result.groups).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it('rejects a version below 1 or above 2', () => {
    expect(loadBackportGroups(fakeStorage(stored([group], 0))).error).toMatch(/version/i);
    expect(loadBackportGroups(fakeStorage(stored([group], 3))).error).toMatch(/version/i);
  });
});

describe('saveBackportGroups', () => {
  it('writes a versioned envelope', () => {
    const storage = fakeStorage();
    saveBackportGroups([group], storage);
    expect(JSON.parse(storage.getItem(BACKPORT_GROUPS_KEY) ?? '')).toEqual({
      version: 2,
      groups: [group],
    });
  });

  it('never throws when storage is unavailable', () => {
    expect(() => saveBackportGroups([group], null)).not.toThrow();
  });
});
