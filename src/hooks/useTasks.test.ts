import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CORRUPT_TASKS_KEY, TASKS_KEY } from '../storage/tasks';
import { useTasks } from './useTasks';

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

const clock = () => '2026-08-27T09:00:00Z';

describe('useTasks — add and remove', () => {
  it('starts empty with no stored tasks', () => {
    const { result } = renderHook(() => useTasks({ storage: fakeStorage(), clock }));
    expect(result.current.tasks).toEqual([]);
    expect(result.current.storageError).toBeNull();
  });

  it('adds a task and persists it', () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => useTasks({ storage, clock }));

    act(() => {
      result.current.addTask({
        kind: 'pr',
        owner: 'Example',
        repo: 'example-server',
        number: 4821,
      });
    });

    expect(result.current.tasks).toEqual([
      { kind: 'pr', owner: 'Example', repo: 'example-server', number: 4821, addedAt: clock() },
    ]);
    expect(JSON.parse(storage.getItem(TASKS_KEY) ?? '')).toEqual({
      version: 1,
      tasks: result.current.tasks,
    });
  });

  it('reports a duplicate add without adding a second entry', () => {
    const { result } = renderHook(() => useTasks({ storage: fakeStorage(), clock }));
    const parsed = { kind: 'pr' as const, owner: 'Example', repo: 'example-server', number: 4821 };

    act(() => {
      result.current.addTask(parsed);
    });
    let outcome: { added: boolean } = { added: true };
    act(() => {
      outcome = result.current.addTask(parsed);
    });

    expect(outcome.added).toBe(false);
    expect(result.current.tasks).toHaveLength(1);
  });

  it('removes a task by key', () => {
    const { result } = renderHook(() => useTasks({ storage: fakeStorage(), clock }));
    act(() => {
      result.current.addTask({
        kind: 'pr',
        owner: 'Example',
        repo: 'example-server',
        number: 4821,
      });
    });
    act(() => {
      result.current.removeTask('example/example-server#4821');
    });
    expect(result.current.tasks).toEqual([]);
  });
});

describe('useTasks — reorder', () => {
  function seeded(storage: Storage) {
    const { result } = renderHook(() => useTasks({ storage, clock }));
    act(() => {
      result.current.addTask({ kind: 'pr', owner: 'a', repo: 'a', number: 1 });
      result.current.addTask({ kind: 'pr', owner: 'a', repo: 'a', number: 2 });
      result.current.addTask({ kind: 'pr', owner: 'a', repo: 'a', number: 3 });
    });
    return result;
  }

  it('moves an item to a later index', () => {
    const result = seeded(fakeStorage());
    act(() => {
      result.current.reorderTasks(0, 2);
    });
    expect(result.current.tasks.map((task) => task.number)).toEqual([2, 3, 1]);
  });

  it('moves an item to an earlier index', () => {
    const result = seeded(fakeStorage());
    act(() => {
      result.current.reorderTasks(2, 0);
    });
    expect(result.current.tasks.map((task) => task.number)).toEqual([3, 1, 2]);
  });

  it('does nothing when the index is unchanged or out of range', () => {
    const result = seeded(fakeStorage());
    const before = result.current.tasks;
    act(() => {
      result.current.reorderTasks(1, 1);
      result.current.reorderTasks(-1, 0);
      result.current.reorderTasks(0, 5);
    });
    expect(result.current.tasks).toEqual(before);
  });

  it('persists the new order', () => {
    const storage = fakeStorage();
    const result = seeded(storage);
    act(() => {
      result.current.reorderTasks(0, 2);
    });
    const stored = JSON.parse(storage.getItem(TASKS_KEY) ?? '');
    expect(stored.tasks.map((task: { number: number }) => task.number)).toEqual([2, 3, 1]);
  });
});

describe('useTasks — corrupt storage', () => {
  it('surfaces the load error and does not overwrite the corrupt backup on mount', () => {
    const storage = fakeStorage({ [TASKS_KEY]: 'not json' });
    const { result } = renderHook(() => useTasks({ storage, clock }));
    expect(result.current.tasks).toEqual([]);
    expect(result.current.storageError).toBeTruthy();
    expect(storage.getItem(CORRUPT_TASKS_KEY)).toBe('not json');
  });

  it('dismisses the storage error', () => {
    const storage = fakeStorage({ [TASKS_KEY]: 'not json' });
    const { result } = renderHook(() => useTasks({ storage, clock }));
    act(() => {
      result.current.dismissStorageError();
    });
    expect(result.current.storageError).toBeNull();
  });
});
