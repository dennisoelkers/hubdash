import type { BackportGroup, BackportSlot } from '../types';
import { readKey, writeKey } from './localStorage';
import { isTrackedPr } from './trackedPrs';

export const BACKPORT_GROUPS_KEY = 'hubdash.backports';
export const CORRUPT_BACKPORT_GROUPS_KEY = 'hubdash.backports.corrupt';

const VERSION = 1;

export type LoadBackportGroupsResult = { groups: BackportGroup[]; error: string | null };

const UNREADABLE = 'Your backport groups could not be read and were reset.';

function isSlot(value: unknown): value is BackportSlot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.version !== 'string' || candidate.version === '') return false;
  return candidate.pr === null || isTrackedPr(candidate.pr);
}

function isGroup(value: unknown): value is BackportGroup {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isTrackedPr(candidate.main) &&
    Array.isArray(candidate.slots) &&
    candidate.slots.every(isSlot) &&
    typeof candidate.addedAt === 'string' &&
    candidate.addedAt !== ''
  );
}

function reject(
  storage: Storage | null | undefined,
  raw: string,
  error: string,
): LoadBackportGroupsResult {
  // Keep the unusable value so a later save cannot destroy the user's groups.
  writeKey(storage, CORRUPT_BACKPORT_GROUPS_KEY, raw);
  return { groups: [], error };
}

export function loadBackportGroups(storage?: Storage | null): LoadBackportGroupsResult {
  const raw = readKey(storage, BACKPORT_GROUPS_KEY);
  if (raw === null) return { groups: [], error: null };

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
  // A missing version is a wrong shape, not an unsupported version — saying
  // otherwise would send someone hunting for a migration that never existed.
  if (!('version' in envelope)) return reject(storage, raw, UNREADABLE);
  if (envelope.version !== VERSION) {
    return reject(storage, raw, 'Your backport groups use an unsupported version and were reset.');
  }
  if (!Array.isArray(envelope.groups) || !envelope.groups.every(isGroup)) {
    return reject(storage, raw, UNREADABLE);
  }

  return { groups: envelope.groups, error: null };
}

export function saveBackportGroups(
  groups: BackportGroup[],
  storage?: Storage | null,
): void {
  writeKey(storage, BACKPORT_GROUPS_KEY, JSON.stringify({ version: VERSION, groups }));
}
