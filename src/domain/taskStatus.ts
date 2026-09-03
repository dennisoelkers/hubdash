import type { IssueEntry, PrEntry } from '../types';
import { classify } from './classify';
import { classifyIssue } from './classifyIssue';

export type TaskStatus =
  | { kind: 'pending' }
  | { kind: 'errored'; message: string }
  | { kind: 'waiting' }
  | { kind: 'needsAction' }
  | { kind: 'ready' }
  | { kind: 'merged' }
  | { kind: 'closed' };

/**
 * A task's display status, per spec §6. `entry` is undefined until the
 * first poll for it resolves, mirroring how the Backports tab treats a slot
 * with no data yet. Status is display-only — it never affects a task's
 * position in the list.
 */
export function taskStatusFor(entry: PrEntry | IssueEntry | undefined): TaskStatus {
  if (entry === undefined) return { kind: 'pending' };
  if (entry.status === 'error') return { kind: 'errored', message: entry.message };

  if ('pr' in entry) {
    if (entry.pr.lifecycle === 'MERGED') return { kind: 'merged' };
    if (entry.pr.lifecycle === 'CLOSED') return { kind: 'closed' };
    const column = classify(entry.pr);
    if (column === 'waiting' || column === 'needsAction' || column === 'ready') {
      return { kind: column };
    }
    // Unreachable: classify() only returns 'archive' for MERGED/CLOSED PRs,
    // both handled above.
    return { kind: 'waiting' };
  }

  return classifyIssue(entry.issue) === 'archive' ? { kind: 'closed' } : { kind: 'waiting' };
}
