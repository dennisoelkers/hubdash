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
  addTask: (parsed: ParsedTask) => { added: boolean; key: PrKey };
  removeTask: (key: PrKey) => void;
  reorderTasks: (fromIndex: number, toIndex: number) => void;
  storageError: string | null;
  dismissStorageError: () => void;
};

function keyOf(task: TrackedTask | ParsedTask): PrKey {
  return prKey(task.owner, task.repo, task.number);
}

/**
 * Owns the task list. Writes are explicit — every mutation saves — and the
 * hook never saves on mount, so an unreadable stored value is not
 * overwritten before the user has had a chance to see the warning about it.
 * Same discipline as useTrackedPrs and useBackportGroups.
 */
export function useTasks(options: UseTasksOptions = {}): UseTasksResult {
  const { storage, clock } = options;
  const now = clock ?? defaultClock;

  const initial = useRef<{ tasks: TrackedTask[]; error: string | null } | null>(null);
  if (initial.current === null) {
    initial.current = loadTasks(storage);
  }

  const [tasks, setTasks] = useState<TrackedTask[]>(initial.current.tasks);
  const [storageError, setStorageError] = useState<string | null>(initial.current.error);

  // Mirrors `tasks` so mutations can decide synchronously and return a
  // verdict — the dialog needs this to flash a duplicate.
  const tasksRef = useRef<TrackedTask[]>(initial.current.tasks);

  const commit = useCallback(
    (next: TrackedTask[]) => {
      tasksRef.current = next;
      saveTasks(next, storage);
      setTasks(next);
    },
    [storage],
  );

  const addTask = useCallback(
    (parsed: ParsedTask) => {
      const key = keyOf(parsed);
      if (tasksRef.current.some((task) => keyOf(task) === key)) {
        return { added: false, key };
      }
      commit([...tasksRef.current, { ...parsed, addedAt: now() }]);
      return { added: true, key };
    },
    [commit, now],
  );

  const removeTask = useCallback(
    (key: PrKey) => {
      const next = tasksRef.current.filter((task) => keyOf(task) !== key);
      if (next.length === tasksRef.current.length) return;
      commit(next);
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
      commit(next);
    },
    [commit],
  );

  const dismissStorageError = useCallback(() => setStorageError(null), []);

  return { tasks, addTask, removeTask, reorderTasks, storageError, dismissStorageError };
}
