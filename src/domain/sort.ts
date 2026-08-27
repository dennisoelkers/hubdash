import type { ColumnId, PrEntry } from '../types';
import { classify } from './classify';

/** 0 sorts above 1 sorts above 2. Errors first, then normal, then drafts. */
function rank(entry: PrEntry): number {
  if (entry.status === 'error') return 0;
  return entry.pr.isDraft ? 2 : 1;
}

function updatedAt(entry: PrEntry): string {
  return entry.status === 'ok' ? entry.pr.updatedAt : entry.tracked.addedAt;
}

function byRankThenRecency(a: PrEntry, b: PrEntry): number {
  const rankDelta = rank(a) - rank(b);
  if (rankDelta !== 0) return rankDelta;
  // ISO 8601 strings in UTC compare correctly as strings; descending.
  return updatedAt(b).localeCompare(updatedAt(a));
}

/**
 * Groups every entry into its column and orders each column, per spec §7.3.
 * An entry that failed to resolve goes to needs action, since removing it or
 * fixing access is the user's call.
 */
export function groupIntoColumns(entries: PrEntry[]): Record<ColumnId, PrEntry[]> {
  const columns: Record<ColumnId, PrEntry[]> = {
    waiting: [],
    needsAction: [],
    ready: [],
    archive: [],
  };

  for (const entry of entries) {
    const column = entry.status === 'error' ? 'needsAction' : classify(entry.pr);
    columns[column].push(entry);
  }

  for (const column of Object.values(columns)) {
    column.sort(byRankThenRecency);
  }

  return columns;
}
