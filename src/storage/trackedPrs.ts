import type { PrKey, TrackedPr } from '../types';
import { readKey, writeKey } from './localStorage';

export const TRACKED_PRS_KEY = 'hubdash.prs';
export const CORRUPT_TRACKED_PRS_KEY = 'hubdash.prs.corrupt';

const CURRENT_VERSION = 2;

export type LoadTrackedPrsResult = {
  prs: TrackedPr[];
  archivedKeys: PrKey[];
  error: string | null;
};

const UNREADABLE = 'Your tracked pull requests could not be read and were reset.';

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

function isPrKeyArray(value: unknown): value is PrKey[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function reject(
  storage: Storage | null | undefined,
  raw: string,
  error: string,
): LoadTrackedPrsResult {
  // Keep the unusable value so a later save cannot destroy the user's list.
  writeKey(storage, CORRUPT_TRACKED_PRS_KEY, raw);
  return { prs: [], archivedKeys: [], error };
}

export function loadTrackedPrs(storage?: Storage | null): LoadTrackedPrsResult {
  const raw = readKey(storage, TRACKED_PRS_KEY);
  if (raw === null) return { prs: [], archivedKeys: [], error: null };

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

  // A version-1 payload predates `archivedKeys`; nothing it names was ever
  // manually archived, since the feature didn't exist yet — the only correct
  // default is an empty set.
  if (envelope.version === 1) {
    if (!Array.isArray(envelope.prs) || !envelope.prs.every(isTrackedPr)) {
      return reject(storage, raw, UNREADABLE);
    }
    return { prs: envelope.prs, archivedKeys: [], error: null };
  }

  if (envelope.version !== CURRENT_VERSION) {
    return reject(
      storage,
      raw,
      'Your tracked pull requests use an unsupported version and were reset.',
    );
  }
  if (!Array.isArray(envelope.prs) || !envelope.prs.every(isTrackedPr)) {
    return reject(storage, raw, UNREADABLE);
  }
  if (!isPrKeyArray(envelope.archivedKeys)) {
    return reject(storage, raw, UNREADABLE);
  }

  return { prs: envelope.prs, archivedKeys: envelope.archivedKeys, error: null };
}

export function saveTrackedPrs(
  prs: TrackedPr[],
  archivedKeys: PrKey[],
  storage?: Storage | null,
): void {
  writeKey(
    storage,
    TRACKED_PRS_KEY,
    JSON.stringify({ version: CURRENT_VERSION, prs, archivedKeys }),
  );
}
