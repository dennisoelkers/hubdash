import { useCallback, useRef, useState } from 'react';
import { prKey } from '../domain/prKey';
import type { ParsedPr } from '../github/parseUrl';
import { loadTrackedPrs, saveTrackedPrs } from '../storage/trackedPrs';
import type { PrKey, TrackedPr } from '../types';

export type UseTrackedPrsOptions = {
  storage?: Storage | null;
  clock?: () => string;
};

export type UseTrackedPrsResult = {
  prs: TrackedPr[];
  add: (parsed: ParsedPr) => { added: boolean; key: PrKey };
  remove: (key: PrKey) => void;
  storageError: string | null;
  dismissStorageError: () => void;
};

function keyOf(pr: TrackedPr | ParsedPr): PrKey {
  return prKey(pr.owner, pr.repo, pr.number);
}

/**
 * Owns the tracked list. Writes are explicit — every mutation saves, and the
 * hook never saves on mount, so an unreadable stored value is not overwritten
 * before the user has had a chance to see the warning about it.
 */
export function useTrackedPrs(options: UseTrackedPrsOptions = {}): UseTrackedPrsResult {
  const { storage, clock } = options;
  const now = clock ?? (() => new Date().toISOString());

  const initial = useRef<{ prs: TrackedPr[]; error: string | null } | null>(null);
  if (initial.current === null) {
    initial.current = loadTrackedPrs(storage);
  }

  const [prs, setPrs] = useState<TrackedPr[]>(initial.current.prs);
  const [storageError, setStorageError] = useState<string | null>(initial.current.error);

  // Mirrors `prs` so add/remove can decide synchronously and return a verdict
  // to the caller, which the dialog needs in order to flash a duplicate.
  const prsRef = useRef<TrackedPr[]>(initial.current.prs);

  const commit = useCallback(
    (next: TrackedPr[]) => {
      prsRef.current = next;
      saveTrackedPrs(next, storage);
      setPrs(next);
    },
    [storage],
  );

  const add = useCallback(
    (parsed: ParsedPr) => {
      const key = keyOf(parsed);
      if (prsRef.current.some((pr) => keyOf(pr) === key)) {
        return { added: false, key };
      }
      commit([...prsRef.current, { ...parsed, addedAt: now() }]);
      return { added: true, key };
    },
    [commit, now],
  );

  const remove = useCallback(
    (key: PrKey) => {
      const next = prsRef.current.filter((pr) => keyOf(pr) !== key);
      if (next.length === prsRef.current.length) return;
      commit(next);
    },
    [commit],
  );

  const dismissStorageError = useCallback(() => setStorageError(null), []);

  return { prs, add, remove, storageError, dismissStorageError };
}
