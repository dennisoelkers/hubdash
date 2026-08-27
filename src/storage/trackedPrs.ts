import type { TrackedPr } from '../types';
import { readKey, writeKey } from './localStorage';

export const TRACKED_PRS_KEY = 'hubdash.prs';
export const CORRUPT_TRACKED_PRS_KEY = 'hubdash.prs.corrupt';

const VERSION = 1;

export type LoadTrackedPrsResult = { prs: TrackedPr[]; error: string | null };

export function isTrackedPr(value: unknown): value is TrackedPr {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
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

function reject(
  storage: Storage | null | undefined,
  raw: string,
  error: string,
): LoadTrackedPrsResult {
  // Keep the unusable value so a later save cannot destroy the user's list.
  writeKey(storage, CORRUPT_TRACKED_PRS_KEY, raw);
  return { prs: [], error };
}

export function loadTrackedPrs(storage?: Storage | null): LoadTrackedPrsResult {
  const raw = readKey(storage, TRACKED_PRS_KEY);
  if (raw === null) return { prs: [], error: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return reject(storage, raw, 'Your tracked pull requests could not be read and were reset.');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return reject(storage, raw, 'Your tracked pull requests could not be read and were reset.');
  }

  const envelope = parsed as Record<string, unknown>;
  // A missing `version` is a wrong envelope, not a future one — say so, rather
  // than sending the reader looking for a migration that was never the problem.
  if (!('version' in envelope)) {
    return reject(storage, raw, 'Your tracked pull requests could not be read and were reset.');
  }
  if (envelope.version !== VERSION) {
    return reject(
      storage,
      raw,
      'Your tracked pull requests use an unsupported version and were reset.',
    );
  }
  if (!Array.isArray(envelope.prs) || !envelope.prs.every(isTrackedPr)) {
    return reject(storage, raw, 'Your tracked pull requests could not be read and were reset.');
  }

  return { prs: envelope.prs, error: null };
}

export function saveTrackedPrs(prs: TrackedPr[], storage?: Storage | null): void {
  writeKey(storage, TRACKED_PRS_KEY, JSON.stringify({ version: VERSION, prs }));
}
