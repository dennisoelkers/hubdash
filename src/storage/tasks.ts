import type { PrKey, TaskKind, TrackedTask } from '../types';
import { readKey, writeKey } from './localStorage';

export const TASKS_KEY = 'hubdash.tasks';
export const CORRUPT_TASKS_KEY = 'hubdash.tasks.corrupt';

const CURRENT_VERSION = 2;

export type LoadTasksResult = { tasks: TrackedTask[]; archivedKeys: PrKey[]; error: string | null };

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

function isPrKeyArray(value: unknown): value is PrKey[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function reject(storage: Storage | null | undefined, raw: string, error: string): LoadTasksResult {
  // Keep the unusable value so a later save cannot destroy the user's list.
  writeKey(storage, CORRUPT_TASKS_KEY, raw);
  return { tasks: [], archivedKeys: [], error };
}

export function loadTasks(storage?: Storage | null): LoadTasksResult {
  const raw = readKey(storage, TASKS_KEY);
  if (raw === null) return { tasks: [], archivedKeys: [], error: null };

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
  if (!('version' in envelope)) {
    return reject(storage, raw, UNREADABLE);
  }

  // A version-1 payload predates archiving on this tab entirely — nothing it
  // names was ever archived.
  if (envelope.version === 1) {
    if (!Array.isArray(envelope.tasks) || !envelope.tasks.every(isTrackedTask)) {
      return reject(storage, raw, UNREADABLE);
    }
    return { tasks: envelope.tasks, archivedKeys: [], error: null };
  }

  if (envelope.version !== CURRENT_VERSION) {
    return reject(storage, raw, 'Your tasks use an unsupported version and were reset.');
  }
  if (!Array.isArray(envelope.tasks) || !envelope.tasks.every(isTrackedTask)) {
    return reject(storage, raw, UNREADABLE);
  }
  if (!isPrKeyArray(envelope.archivedKeys)) {
    return reject(storage, raw, UNREADABLE);
  }

  return { tasks: envelope.tasks, archivedKeys: envelope.archivedKeys, error: null };
}

export function saveTasks(
  tasks: TrackedTask[],
  archivedKeys: PrKey[],
  storage?: Storage | null,
): void {
  writeKey(
    storage,
    TASKS_KEY,
    JSON.stringify({ version: CURRENT_VERSION, tasks, archivedKeys }),
  );
}
