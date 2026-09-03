import type { TaskKind, TrackedTask } from '../types';
import { readKey, writeKey } from './localStorage';

export const TASKS_KEY = 'hubdash.tasks';
export const CORRUPT_TASKS_KEY = 'hubdash.tasks.corrupt';

const VERSION = 1;

export type LoadTasksResult = { tasks: TrackedTask[]; error: string | null };

const UNREADABLE = 'Your tasks could not be read and were reset.';

function isTaskKind(value: unknown): value is TaskKind {
  return value === 'pr' || value === 'issue';
}

export function isTrackedTask(value: unknown): value is TrackedTask {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isTaskKind(candidate.kind) &&
    typeof candidate.owner === 'string' &&
    candidate.owner !== '' &&
    typeof candidate.repo === 'string' &&
    candidate.repo !== '' &&
    typeof candidate.number === 'number' &&
    Number.isInteger(candidate.number) &&
    candidate.number > 0 &&
    typeof candidate.addedAt === 'string' &&
    candidate.addedAt !== ''
  );
}

function reject(storage: Storage | null | undefined, raw: string, error: string): LoadTasksResult {
  // Keep the unusable value so a later save cannot destroy the user's list.
  writeKey(storage, CORRUPT_TASKS_KEY, raw);
  return { tasks: [], error };
}

export function loadTasks(storage?: Storage | null): LoadTasksResult {
  const raw = readKey(storage, TASKS_KEY);
  if (raw === null) return { tasks: [], error: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return reject(storage, raw, UNREADABLE);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return reject(storage, raw, UNREADABLE);
  }

  const envelope = parsed as Record<string, unknown>;
  // A missing `version` is a wrong envelope, not a future one.
  if (!('version' in envelope)) {
    return reject(storage, raw, UNREADABLE);
  }
  if (envelope.version !== VERSION) {
    return reject(storage, raw, 'Your tasks use an unsupported version and were reset.');
  }
  if (!Array.isArray(envelope.tasks) || !envelope.tasks.every(isTrackedTask)) {
    return reject(storage, raw, UNREADABLE);
  }

  return { tasks: envelope.tasks, error: null };
}

export function saveTasks(tasks: TrackedTask[], storage?: Storage | null): void {
  writeKey(storage, TASKS_KEY, JSON.stringify({ version: VERSION, tasks }));
}
