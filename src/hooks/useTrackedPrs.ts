import { useCallback, useRef, useState } from 'react';
import { prKey } from '../domain/prKey';
import type { ParsedPr } from '../github/parseUrl';
import { loadTrackedPrs, saveTrackedPrs } from '../storage/trackedPrs';
import type { PrKey, TrackedPr } from '../types';

/**
 * Module-level so its identity is stable. Inlining this as
 * `clock ?? (() => new Date().toISOString())` would mint a new function on
 * every render, which defeats the memoization of `add` — and App re-renders
 * once a second to drive the freshness label, so that churn is continuous.
 */
const defaultClock = () => new Date().toISOString();

export type UseTrackedPrsOptions = {
  storage?: Storage | null;
  clock?: () => string;
};

export type UseTrackedPrsResult = {
  prs: TrackedPr[];
  archivedKeys: PrKey[];
  add: (parsed: ParsedPr) => { added: boolean; key: PrKey };
  remove: (key: PrKey) => void;
  archivePr: (key: PrKey) => void;
  storageError: string | null;
  dismissStorageError: () => void;
};

function keyOf(pr: TrackedPr | ParsedPr): PrKey {
  return prKey(pr.owner, pr.repo, pr.number);
}

/**
 * Owns the tracked list and, since this feature, the separate set of
 * manually-archived keys alongside it — see the plan's note on why this is
 * not a field on `TrackedPr` itself. Writes are explicit — every mutation
 * saves both pieces together — and the hook never saves on mount, so an
 * unreadable stored value is not overwritten before the user has had a
 * chance to see the warning about it.
 */
export function useTrackedPrs(options: UseTrackedPrsOptions = {}): UseTrackedPrsResult {
  const { storage, clock } = options;
  const now = clock ?? defaultClock;

  const initial = useRef<{
    prs: TrackedPr[];
    archivedKeys: PrKey[];
    error: string | null;
  } | null>(null);
  if (initial.current === null) {
    initial.current = loadTrackedPrs(storage);
  }

  const [prs, setPrs] = useState<TrackedPr[]>(initial.current.prs);
  const [archivedKeys, setArchivedKeys] = useState<PrKey[]>(initial.current.archivedKeys);
  const [storageError, setStorageError] = useState<string | null>(initial.current.error);

  // Mirrors `prs`/`archivedKeys` so mutations can decide synchronously and
  // return a verdict to the caller, which the dialog needs in order to flash
  // a duplicate.
  const prsRef = useRef<TrackedPr[]>(initial.current.prs);
  const archivedRef = useRef<PrKey[]>(initial.current.archivedKeys);

  const commit = useCallback(
    (nextPrs: TrackedPr[], nextArchived: PrKey[]) => {
      prsRef.current = nextPrs;
      archivedRef.current = nextArchived;
      saveTrackedPrs(nextPrs, nextArchived, storage);
      setPrs(nextPrs);
      setArchivedKeys(nextArchived);
    },
    [storage],
  );

  const add = useCallback(
    (parsed: ParsedPr) => {
      const key = keyOf(parsed);
      if (prsRef.current.some((pr) => keyOf(pr) === key)) {
        return { added: false, key };
      }
      commit([...prsRef.current, { ...parsed, addedAt: now() }], archivedRef.current);
      return { added: true, key };
    },
    [commit, now],
  );

  const remove = useCallback(
    (key: PrKey) => {
      const next = prsRef.current.filter((pr) => keyOf(pr) !== key);
      if (next.length === prsRef.current.length) return;
      // Drop a stale archived key too, so nothing dangles for a PR no longer
      // tracked at all.
      const nextArchived = archivedRef.current.filter((archivedKey) => archivedKey !== key);
      commit(next, nextArchived);
    },
    [commit],
  );

  const archivePr = useCallback(
    (key: PrKey) => {
      if (archivedRef.current.includes(key)) return;
      commit(prsRef.current, [...archivedRef.current, key]);
    },
    [commit],
  );

  const dismissStorageError = useCallback(() => setStorageError(null), []);

  return { prs, archivedKeys, add, remove, archivePr, storageError, dismissStorageError };
}
