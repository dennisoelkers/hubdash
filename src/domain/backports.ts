import type {
  BackportGroup,
  BackportSlot,
  PrEntry,
  PrKey,
  SlotState,
  TrackedPr,
} from '../types';
import { prKey } from './prKey';

/**
 * A group's identity is its main PR's key. Deriving it rather than generating an
 * id keeps one canonical identity format in the codebase and makes duplicate
 * detection a lookup rather than a search.
 */
export function groupKey(group: BackportGroup): PrKey {
  return prKey(group.main.owner, group.main.repo, group.main.number);
}

/** Every PR this group needs polled: its main, plus each filled slot. */
export function groupPrs(group: BackportGroup): TrackedPr[] {
  const prs: TrackedPr[] = [group.main];
  for (const slot of group.slots) {
    if (slot.pr !== null) prs.push(slot.pr);
  }
  return prs;
}

/**
 * Merge status for a bare PR. This is the only place the tab derives status,
 * and it reads nothing but the lifecycle — no CI, no review, no classification.
 * Takes `TrackedPr | null` rather than a `BackportSlot` so a group's main PR —
 * which is not a slot — can share this derivation with `slotStateFor` below,
 * rather than `BackportGroupCard` reimplementing it for the main row.
 */
export function prStateFor(pr: TrackedPr | null, entries: Map<PrKey, PrEntry>): SlotState {
  if (pr === null) return { kind: 'empty' };

  const entry = entries.get(prKey(pr.owner, pr.repo, pr.number));
  if (entry === undefined) return { kind: 'pending' };
  if (entry.status === 'error') return { kind: 'errored', message: entry.message };

  switch (entry.pr.lifecycle) {
    case 'MERGED':
      return { kind: 'merged' };
    case 'CLOSED':
      return { kind: 'closed' };
    case 'OPEN':
      return { kind: 'open' };
  }
}

/** Merge status for one slot. A thin wrapper over `prStateFor` — see above. */
export function slotStateFor(slot: BackportSlot, entries: Map<PrKey, PrEntry>): SlotState {
  return prStateFor(slot.pr, entries);
}

export type RollUp = { landed: number; total: number };

/**
 * How many target versions have landed. The main PR is excluded from both
 * numbers: it is the thing being backported, not a backport.
 */
export function rollUpFor(group: BackportGroup, entries: Map<PrKey, PrEntry>): RollUp {
  const landed = group.slots.filter(
    (slot) => slotStateFor(slot, entries).kind === 'merged',
  ).length;
  return { landed, total: group.slots.length };
}

/**
 * A group is finished when it asked for at least one version and every one has
 * merged. A group with no versions is deliberately NOT complete — nothing landed
 * because nothing was asked for, and calling it done would bury a group the user
 * is still setting up.
 */
export function isComplete(group: BackportGroup, entries: Map<PrKey, PrEntry>): boolean {
  const { landed, total } = rollUpFor(group, entries);
  return total > 0 && landed === total;
}

/**
 * Incomplete groups first, then finished ones, each by recency. This mirrors the
 * board's instinct of surfacing what still needs attention; a finished group
 * stays until removed, because deciding when landed work stops being interesting
 * is the user's call.
 */
export function orderGroups(
  groups: BackportGroup[],
  entries: Map<PrKey, PrEntry>,
): BackportGroup[] {
  return [...groups].sort((a, b) => {
    const completeDelta = Number(isComplete(a, entries)) - Number(isComplete(b, entries));
    if (completeDelta !== 0) return completeDelta;
    // ISO 8601 in UTC compares correctly as strings; descending.
    return b.addedAt.localeCompare(a.addedAt);
  });
}
