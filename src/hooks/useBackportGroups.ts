import { useCallback, useRef, useState } from 'react';
import { groupKey } from '../domain/backports';
import { prKey } from '../domain/prKey';
import type { ParsedPr } from '../github/parseUrl';
import { loadBackportGroups, saveBackportGroups } from '../storage/backportGroups';
import type { BackportGroup, BackportSlot, PrKey, TrackedPr } from '../types';

/**
 * Module-level so its identity is stable. Inlining this as
 * `clock ?? (() => new Date().toISOString())` would mint a new function on every
 * render and defeat the memoisation below — and App re-renders once a second to
 * drive the freshness label, so that churn would be continuous.
 */
const defaultClock = () => new Date().toISOString();

export type UseBackportGroupsOptions = {
  storage?: Storage | null;
  clock?: () => string;
};

export type FillSlotOutcome = { ok: true } | { ok: false; error: string };

export type UseBackportGroupsResult = {
  groups: BackportGroup[];
  addGroup: (main: ParsedPr, versions: string[]) => { added: boolean; key: PrKey };
  removeGroup: (key: PrKey) => void;
  addVersion: (key: PrKey, version: string) => void;
  removeVersion: (key: PrKey, version: string) => void;
  fillSlot: (key: PrKey, version: string, pr: ParsedPr) => FillSlotOutcome;
  archiveGroup: (key: PrKey) => void;
  storageError: string | null;
  dismissStorageError: () => void;
};

function keyOf(pr: TrackedPr | ParsedPr): PrKey {
  return prKey(pr.owner, pr.repo, pr.number);
}

/** Where in a group a PR is already used, or null if it is free. */
function usedIn(group: BackportGroup, pr: ParsedPr, exceptVersion: string): string | null {
  const key = keyOf(pr);
  if (keyOf(group.main) === key) return 'main';
  for (const slot of group.slots) {
    if (slot.version === exceptVersion) continue;
    if (slot.pr !== null && keyOf(slot.pr) === key) return slot.version;
  }
  return null;
}

/**
 * Owns the backport groups. Writes are explicit — every mutation saves — and the
 * hook never saves on mount, so an unreadable stored value is not overwritten
 * before the user has seen the warning about it.
 */
export function useBackportGroups(
  options: UseBackportGroupsOptions = {},
): UseBackportGroupsResult {
  const { storage, clock } = options;
  const now = clock ?? defaultClock;

  const initial = useRef<{ groups: BackportGroup[]; error: string | null } | null>(null);
  if (initial.current === null) {
    initial.current = loadBackportGroups(storage);
  }

  const [groups, setGroups] = useState<BackportGroup[]>(initial.current.groups);
  const [storageError, setStorageError] = useState<string | null>(initial.current.error);

  // Mirrors `groups` so mutations decide synchronously and return a verdict the
  // caller can act on — flashing a duplicate, or showing a rejection.
  const groupsRef = useRef<BackportGroup[]>(initial.current.groups);

  const commit = useCallback(
    (next: BackportGroup[]) => {
      groupsRef.current = next;
      saveBackportGroups(next, storage);
      setGroups(next);
    },
    [storage],
  );

  /** Applies `change` to the group with `key`, committing only if it produced a new value. */
  const mapGroup = useCallback(
    (key: PrKey, change: (group: BackportGroup) => BackportGroup | null) => {
      let changed = false;
      const next = groupsRef.current.map((group) => {
        if (groupKey(group) !== key) return group;
        const updated = change(group);
        if (updated === null) return group;
        changed = true;
        return updated;
      });
      if (changed) commit(next);
    },
    [commit],
  );

  const addGroup = useCallback(
    (main: ParsedPr, versions: string[]) => {
      const key = keyOf(main);
      if (groupsRef.current.some((group) => groupKey(group) === key)) {
        return { added: false, key };
      }
      const addedAt = now();
      commit([
        ...groupsRef.current,
        {
          main: { ...main, addedAt },
          slots: versions.map((version) => ({ version, pr: null })),
          addedAt,
          archived: false,
        },
      ]);
      return { added: true, key };
    },
    [commit, now],
  );

  const removeGroup = useCallback(
    (key: PrKey) => {
      const next = groupsRef.current.filter((group) => groupKey(group) !== key);
      if (next.length === groupsRef.current.length) return;
      commit(next);
    },
    [commit],
  );

  const addVersion = useCallback(
    (key: PrKey, version: string) => {
      mapGroup(key, (group) =>
        group.slots.some((slot) => slot.version === version)
          ? null
          : { ...group, slots: [...group.slots, { version, pr: null }] },
      );
    },
    [mapGroup],
  );

  const removeVersion = useCallback(
    (key: PrKey, version: string) => {
      mapGroup(key, (group) => {
        const slots = group.slots.filter((slot) => slot.version !== version);
        return slots.length === group.slots.length ? null : { ...group, slots };
      });
    },
    [mapGroup],
  );

  const fillSlot = useCallback(
    (key: PrKey, version: string, pr: ParsedPr): FillSlotOutcome => {
      const group = groupsRef.current.find((candidate) => groupKey(candidate) === key);
      if (!group) return { ok: true };
      if (!group.slots.some((slot) => slot.version === version)) return { ok: true };

      const clash = usedIn(group, pr, version);
      if (clash !== null) {
        return {
          ok: false,
          error:
            clash === 'main'
              ? 'That is this group’s main pull request, so it cannot also be one of its backports.'
              : `That pull request is already filling the ${clash} slot.`,
        };
      }

      const filled: TrackedPr = { ...pr, addedAt: now() };
      mapGroup(key, (current) => ({
        ...current,
        slots: current.slots.map((slot: BackportSlot) =>
          slot.version === version ? { ...slot, pr: filled } : slot,
        ),
      }));
      return { ok: true };
    },
    [mapGroup, now],
  );

  const archiveGroup = useCallback(
    (key: PrKey) => {
      mapGroup(key, (group) => (group.archived ? null : { ...group, archived: true }));
    },
    [mapGroup],
  );

  const dismissStorageError = useCallback(() => setStorageError(null), []);

  return {
    groups,
    addGroup,
    removeGroup,
    addVersion,
    removeVersion,
    fillSlot,
    archiveGroup,
    storageError,
    dismissStorageError,
  };
}
