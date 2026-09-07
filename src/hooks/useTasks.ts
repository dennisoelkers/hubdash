import { useCallback, useRef, useState } from 'react';
import { prKey } from '../domain/prKey';
import type { ParsedTask } from '../github/parseTaskUrl';
import { loadTasks, saveTasks } from '../storage/tasks';
import type { PrKey, TrackedTask } from '../types';

/**
 * Module-level so its identity is stable, for the same reason
 * useTrackedPrs/useBackportGroups hoist their own default clocks.
 */
const defaultClock = () => new Date().toISOString();

export type UseTasksOptions = {
  storage?: Storage | null;
  clock?: () => string;
};

export type UseTasksResult = {
  tasks: TrackedTask[];
  archivedKeys: PrKey[];
  addTask: (parsed: ParsedTask) => { added: boolean; key: PrKey };
  removeTask: (key: PrKey) => void;
  reorderTasks: (fromIndex: number, toIndex: number) => void;
  archiveTask: (key: PrKey) => void;
  storageError: string | null;
  dismissStorageError: () => void;
};

function keyOf(task: TrackedTask | ParsedTask): PrKey {
  return prKey(task.owner, task.repo, task.number);
}

/**
 * Owns the task list and, since this feature, the separate set of archived
 * keys alongside it — see the plan's note on why `archived` is not a field
 * on `TrackedTask` itself. Writes are explicit — every mutation saves both
 * pieces together — and the hook never saves on mount, so an unreadable
 * stored value is not overwritten before the user has had a chance to see
 * the warning about it. Same discipline as useTrackedPrs and
 * useBackportGroups.
 */
export function useTasks(options: UseTasksOptions = {}): UseTasksResult {
  const { storage, clock } = options;
  const now = clock ?? defaultClock;

  const initial = useRef<{
    tasks: TrackedTask[];
    archivedKeys: PrKey[];
    error: string | null;
  } | null>(null);
  if (initial.current === null) {
    initial.current = loadTasks(storage);
  }

  const [tasks, setTasks] = useState<TrackedTask[]>(initial.current.tasks);
  const [archivedKeys, setArchivedKeys] = useState<PrKey[]>(initial.current.archivedKeys);
  const [storageError, setStorageError] = useState<string | null>(initial.current.error);

  const tasksRef = useRef<TrackedTask[]>(initial.current.tasks);
  const archivedRef = useRef<PrKey[]>(initial.current.archivedKeys);

  const commit = useCallback(
    (nextTasks: TrackedTask[], nextArchived: PrKey[]) => {
      tasksRef.current = nextTasks;
      archivedRef.current = nextArchived;
      saveTasks(nextTasks, nextArchived, storage);
      setTasks(nextTasks);
      setArchivedKeys(nextArchived);
    },
    [storage],
  );

  const addTask = useCallback(
    (parsed: ParsedTask) => {
      const key = keyOf(parsed);
      if (tasksRef.current.some((task) => keyOf(task) === key)) {
        return { added: false, key };
      }
      commit([...tasksRef.current, { ...parsed, addedAt: now() }], archivedRef.current);
      return { added: true, key };
    },
    [commit, now],
  );

  const removeTask = useCallback(
    (key: PrKey) => {
      const next = tasksRef.current.filter((task) => keyOf(task) !== key);
      if (next.length === tasksRef.current.length) return;
      const nextArchived = archivedRef.current.filter((archivedKey) => archivedKey !== key);
      commit(next, nextArchived);
    },
    [commit],
  );

  const reorderTasks = useCallback(
    (fromIndex: number, toIndex: number) => {
      const current = tasksRef.current;
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.length ||
        toIndex >= current.length
      ) {
        return;
      }
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      if (moved === undefined) return;
      next.splice(toIndex, 0, moved);
      commit(next, archivedRef.current);
    },
    [commit],
  );

  const archiveTask = useCallback(
    (key: PrKey) => {
      if (archivedRef.current.includes(key)) return;
      commit(tasksRef.current, [...archivedRef.current, key]);
    },
    [commit],
  );

  const dismissStorageError = useCallback(() => setStorageError(null), []);

  return {
    tasks,
    archivedKeys,
    addTask,
    removeTask,
    reorderTasks,
    archiveTask,
    storageError,
    dismissStorageError,
  };
}
