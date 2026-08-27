import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BACKPORT_GROUPS_KEY } from '../storage/backportGroups';
import { useBackportGroups } from './useBackportGroups';

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

const clock = () => '2026-08-27T12:00:00Z';
const MAIN = { owner: 'Graylog2', repo: 'graylog2-server', number: 4821 };
const KEY = 'graylog2/graylog2-server#4821';

function setup(storage: Storage = fakeStorage()) {
  return renderHook(() => useBackportGroups({ storage, clock }));
}

describe('useBackportGroups — creating and removing groups', () => {
  it('starts empty when nothing is stored', () => {
    const { result } = setup();
    expect(result.current.groups).toEqual([]);
    expect(result.current.storageError).toBeNull();
  });

  it('adds a group with one slot per version, all empty', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2', '6.1']);
    });
    expect(result.current.groups).toEqual([
      {
        main: { ...MAIN, addedAt: '2026-08-27T12:00:00Z' },
        slots: [
          { version: '6.2', pr: null },
          { version: '6.1', pr: null },
        ],
        addedAt: '2026-08-27T12:00:00Z',
      },
    ]);
  });

  it('accepts a group with no versions', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, []);
    });
    expect(result.current.groups[0]?.slots).toEqual([]);
  });

  it('reports added:true with the key for a new group', () => {
    const { result } = setup();
    let outcome: { added: boolean; key: string } | undefined;
    act(() => {
      outcome = result.current.addGroup(MAIN, ['6.2']);
    });
    expect(outcome).toEqual({ added: true, key: KEY });
  });

  it('reports added:false and does not duplicate a group for the same main PR', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    let outcome: { added: boolean; key: string } | undefined;
    act(() => {
      outcome = result.current.addGroup(MAIN, ['6.1']);
    });
    expect(outcome?.added).toBe(false);
    expect(result.current.groups).toHaveLength(1);
    // The existing group is left exactly as it was, not merged with the new versions.
    expect(result.current.groups[0]?.slots.map((s) => s.version)).toEqual(['6.2']);
  });

  it('treats a casing difference as the same main PR', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    let outcome: { added: boolean } | undefined;
    act(() => {
      outcome = result.current.addGroup(
        { owner: 'GRAYLOG2', repo: 'Graylog2-Server', number: 4821 },
        ['6.1'],
      );
    });
    expect(outcome?.added).toBe(false);
  });

  it('adds two groups in sequence without losing the first', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, []);
      result.current.addGroup({ ...MAIN, number: 4900 }, []);
    });
    expect(result.current.groups.map((g) => g.main.number)).toEqual([4821, 4900]);
  });

  it('removes a group by key and persists the removal', () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => useBackportGroups({ storage, clock }));
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    act(() => {
      result.current.removeGroup(KEY);
    });
    expect(result.current.groups).toEqual([]);
    expect(JSON.parse(storage.getItem(BACKPORT_GROUPS_KEY) ?? '').groups).toEqual([]);
  });

  it('ignores a remove for an unknown key', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, []);
    });
    act(() => {
      result.current.removeGroup('nope/nope#1');
    });
    expect(result.current.groups).toHaveLength(1);
  });
});

describe('useBackportGroups — versions', () => {
  it('adds a version as a new empty slot at the end', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    act(() => {
      result.current.addVersion(KEY, '6.1');
    });
    expect(result.current.groups[0]?.slots).toEqual([
      { version: '6.2', pr: null },
      { version: '6.1', pr: null },
    ]);
  });

  it('ignores a version the group already has', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    act(() => {
      result.current.addVersion(KEY, '6.2');
    });
    expect(result.current.groups[0]?.slots).toHaveLength(1);
  });

  it('removes a version and its PR without confirmation', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2', '6.1']);
    });
    act(() => {
      result.current.fillSlot(KEY, '6.2', { ...MAIN, number: 4840 });
    });
    act(() => {
      result.current.removeVersion(KEY, '6.2');
    });
    expect(result.current.groups[0]?.slots).toEqual([{ version: '6.1', pr: null }]);
  });

  it('ignores a remove for a version the group does not have', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    act(() => {
      result.current.removeVersion(KEY, '5.0');
    });
    expect(result.current.groups[0]?.slots).toHaveLength(1);
  });
});

describe('useBackportGroups — filling slots', () => {
  it('fills an empty slot and persists it', () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => useBackportGroups({ storage, clock }));
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    act(() => {
      result.current.fillSlot(KEY, '6.2', { ...MAIN, number: 4840 });
    });
    expect(result.current.groups[0]?.slots[0]?.pr).toEqual({
      ...MAIN,
      number: 4840,
      addedAt: '2026-08-27T12:00:00Z',
    });
    expect(JSON.parse(storage.getItem(BACKPORT_GROUPS_KEY) ?? '').groups[0].slots[0].pr.number).toBe(4840);
  });

  it('replaces the PR in an already-filled slot', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    act(() => {
      result.current.fillSlot(KEY, '6.2', { ...MAIN, number: 4840 });
    });
    let outcome: { ok: boolean } | undefined;
    act(() => {
      outcome = result.current.fillSlot(KEY, '6.2', { ...MAIN, number: 4899 });
    });
    expect(outcome?.ok).toBe(true);
    expect(result.current.groups[0]?.slots[0]?.pr?.number).toBe(4899);
  });

  it('rejects a PR already filling another slot in the same group, naming where', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2', '6.1']);
    });
    act(() => {
      result.current.fillSlot(KEY, '6.2', { ...MAIN, number: 4840 });
    });
    let outcome: { ok: boolean; error?: string } | undefined;
    act(() => {
      outcome = result.current.fillSlot(KEY, '6.1', { ...MAIN, number: 4840 });
    });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toMatch(/6\.2/);
    expect(result.current.groups[0]?.slots[1]?.pr).toBeNull();
  });

  it('rejects the group main PR being used as one of its own backports', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    let outcome: { ok: boolean; error?: string } | undefined;
    act(() => {
      outcome = result.current.fillSlot(KEY, '6.2', MAIN);
    });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toMatch(/main/i);
  });

  it('allows the same PR in two different groups', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
      result.current.addGroup({ ...MAIN, number: 4900 }, ['6.2']);
    });
    let outcome: { ok: boolean } | undefined;
    act(() => {
      result.current.fillSlot(KEY, '6.2', { ...MAIN, number: 4840 });
      outcome = result.current.fillSlot('graylog2/graylog2-server#4900', '6.2', {
        ...MAIN,
        number: 4840,
      });
    });
    expect(outcome?.ok).toBe(true);
  });

  it('ignores a fill for an unknown group or version', () => {
    const { result } = setup();
    act(() => {
      result.current.addGroup(MAIN, ['6.2']);
    });
    act(() => {
      result.current.fillSlot('nope/nope#1', '6.2', { ...MAIN, number: 4840 });
      result.current.fillSlot(KEY, '9.9', { ...MAIN, number: 4840 });
    });
    expect(result.current.groups[0]?.slots[0]?.pr).toBeNull();
  });
});

describe('useBackportGroups — storage errors', () => {
  it('surfaces a load error and lets it be dismissed', () => {
    const { result } = setup(fakeStorage({ [BACKPORT_GROUPS_KEY]: 'not json{' }));
    expect(result.current.storageError).toBeTruthy();
    act(() => {
      result.current.dismissStorageError();
    });
    expect(result.current.storageError).toBeNull();
  });

  it('does not overwrite an unreadable stored value until the user changes something', () => {
    const storage = fakeStorage({ [BACKPORT_GROUPS_KEY]: 'not json{' });
    renderHook(() => useBackportGroups({ storage, clock }));
    expect(storage.getItem(BACKPORT_GROUPS_KEY)).toBe('not json{');
  });
});
