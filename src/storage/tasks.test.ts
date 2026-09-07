import { describe, expect, it } from 'vitest';
import { CORRUPT_TASKS_KEY, TASKS_KEY, isTrackedTask, loadTasks, saveTasks } from './tasks';

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

describe('isTrackedTask', () => {
  it('accepts a well-formed task of either kind', () => {
    expect(
      isTrackedTask({ kind: 'pr', owner: 'a', repo: 'b', number: 1, addedAt: '2026-08-27T09:00:00Z' }),
    ).toBe(true);
    expect(
      isTrackedTask({
        kind: 'issue',
        owner: 'a',
        repo: 'b',
        number: 1,
        addedAt: '2026-08-27T09:00:00Z',
      }),
    ).toBe(true);
  });

  it('rejects a value with an unrecognised kind', () => {
    expect(
      isTrackedTask({
        kind: 'discussion',
        owner: 'a',
        repo: 'b',
        number: 1,
        addedAt: '2026-08-27T09:00:00Z',
      }),
    ).toBe(false);
  });

  it('rejects a non-positive or non-integer number', () => {
    expect(
      isTrackedTask({ kind: 'pr', owner: 'a', repo: 'b', number: 0, addedAt: '2026-08-27T09:00:00Z' }),
    ).toBe(false);
    expect(
      isTrackedTask({
        kind: 'pr',
        owner: 'a',
        repo: 'b',
        number: 1.5,
        addedAt: '2026-08-27T09:00:00Z',
      }),
    ).toBe(false);
  });

  it('rejects a missing field', () => {
    expect(isTrackedTask({ kind: 'pr', owner: 'a', repo: 'b', number: 1 })).toBe(false);
  });
});

describe('loadTasks', () => {
  it('returns an empty list and no archived keys when nothing is stored', () => {
    expect(loadTasks(fakeStorage())).toEqual({ tasks: [], archivedKeys: [], error: null });
  });

  it('loads a version-1 payload, defaulting archivedKeys to empty', () => {
    const storage = fakeStorage({
      [TASKS_KEY]: JSON.stringify({
        version: 1,
        tasks: [{ kind: 'pr', owner: 'a', repo: 'b', number: 1, addedAt: '2026-08-27T09:00:00Z' }],
      }),
    });
    expect(loadTasks(storage)).toEqual({
      tasks: [{ kind: 'pr', owner: 'a', repo: 'b', number: 1, addedAt: '2026-08-27T09:00:00Z' }],
      archivedKeys: [],
      error: null,
    });
  });

  it('backs up and resets on unreadable JSON', () => {
    const storage = fakeStorage({ [TASKS_KEY]: 'not json' });
    const result = loadTasks(storage);
    expect(result.tasks).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(storage.getItem(CORRUPT_TASKS_KEY)).toBe('not json');
  });

  it('backs up and resets on a wrong envelope shape', () => {
    const storage = fakeStorage({ [TASKS_KEY]: JSON.stringify({ tasks: [] }) });
    const result = loadTasks(storage);
    expect(result.tasks).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(storage.getItem(CORRUPT_TASKS_KEY)).toBeTruthy();
  });

  it('backs up and resets on an unsupported version', () => {
    const storage = fakeStorage({ [TASKS_KEY]: JSON.stringify({ version: 99, tasks: [] }) });
    const result = loadTasks(storage);
    expect(result.tasks).toEqual([]);
    expect(result.error).toMatch(/unsupported version/);
  });

  it('backs up and resets when an entry in the array is malformed', () => {
    const storage = fakeStorage({
      [TASKS_KEY]: JSON.stringify({ version: 1, tasks: [{ kind: 'pr', owner: 'a' }] }),
    });
    const result = loadTasks(storage);
    expect(result.tasks).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});

describe('saveTasks', () => {
  it('round-trips through loadTasks', () => {
    const storage = fakeStorage();
    saveTasks(
      [{ kind: 'issue', owner: 'a', repo: 'b', number: 2, addedAt: '2026-08-27T09:00:00Z' }],
      [],
      storage,
    );
    expect(loadTasks(storage)).toEqual({
      tasks: [{ kind: 'issue', owner: 'a', repo: 'b', number: 2, addedAt: '2026-08-27T09:00:00Z' }],
      archivedKeys: [],
      error: null,
    });
  });
});

describe('loadTasks — archived keys', () => {
  it('round-trips archived keys alongside the tasks', () => {
    const storage = fakeStorage();
    saveTasks(
      [{ kind: 'pr', owner: 'a', repo: 'b', number: 1, addedAt: '2026-08-27T09:00:00Z' }],
      ['a/b#1'],
      storage,
    );
    expect(loadTasks(storage)).toEqual({
      tasks: [{ kind: 'pr', owner: 'a', repo: 'b', number: 1, addedAt: '2026-08-27T09:00:00Z' }],
      archivedKeys: ['a/b#1'],
      error: null,
    });
  });

  it('rejects a version-2 payload whose archivedKeys is not a string array', () => {
    const raw = JSON.stringify({ version: 2, tasks: [], archivedKeys: [1] });
    const result = loadTasks(fakeStorage({ [TASKS_KEY]: raw }));
    expect(result.tasks).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});
