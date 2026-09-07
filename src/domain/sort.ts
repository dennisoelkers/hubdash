import type { ColumnId, PrEntry, PrKey } from '../types';
import { classify } from './classify';

/**
 * 0 sorts above 1 sorts above 2. Errors first, then normal, then drafts.
 *
 * Spec §7.3 asks for drafts-last only in Needs action, but the rank is applied
 * board-wide because scoping it would cost a branch to buy nothing. Waiting and
 * Ready cannot hold a draft at all — §6 sends every open draft to Needs action —
 * so the only entry the wider rule can reach elsewhere is a CLOSED draft in
 * Archive, and pinning an abandoned draft below the merged work it never became
 * is the ordering one would have asked for anyway.
 */
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
 * Groups every entry into its column and orders each column, per spec §7.3
 * (v1) and the manual-archiving spec §4. `archivedKeys` — a manually
 * archived PR (this feature) — is checked first, ahead of even the error
 * branch: a user's decision to archive something should not be overridden
 * by a later transient poll failure on it. An entry that failed to resolve
 * goes to needs action otherwise, since removing it or fixing access is the
 * user's call.
 */
export function groupIntoColumns(
  entries: PrEntry[],
  archivedKeys: Set<PrKey> = new Set(),
): Record<ColumnId, PrEntry[]> {
  const columns: Record<ColumnId, PrEntry[]> = {
    waiting: [],
    needsAction: [],
    ready: [],
    archive: [],
  };

  for (const entry of entries) {
    const column = archivedKeys.has(entry.key)
      ? 'archive'
      : entry.status === 'error'
        ? 'needsAction'
        : classify(entry.pr);
    columns[column].push(entry);
  }

  for (const column of Object.values(columns)) {
    column.sort(byRankThenRecency);
  }

  return columns;
}
