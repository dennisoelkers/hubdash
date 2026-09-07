import type { PrKey } from '../types';

export type BoardColumns = { waiting: PrKey[]; needsAction: PrKey[]; ready: PrKey[] };
export type GridPosition = { column: keyof BoardColumns; index: number };
export type GridDirection = 'up' | 'down' | 'left' | 'right';

const COLUMN_ORDER: (keyof BoardColumns)[] = ['waiting', 'needsAction', 'ready'];

function firstNonEmpty(columns: BoardColumns): GridPosition | null {
  for (const column of COLUMN_ORDER) {
    if (columns[column].length > 0) return { column, index: 0 };
  }
  return null;
}

/** Where `key` currently sits, or null if it names nothing in `columns`. */
export function positionOf(columns: BoardColumns, key: PrKey | null): GridPosition | null {
  if (key === null) return null;
  for (const column of COLUMN_ORDER) {
    const index = columns[column].indexOf(key);
    if (index !== -1) return { column, index };
  }
  return null;
}

/**
 * Where the selection moves to from `current`, per spec §4. Up/down moves
 * within a column; left/right moves to the next non-empty column in that
 * direction (skipping any empty one in between), landing on the same row —
 * clamped to that column's last item if it's shorter. No wrap-around:
 * moving past an edge is a no-op, returning `current` unchanged. `current`
 * naming an empty or now-gone column (data shifted under it) is treated the
 * same as no selection at all.
 */
export function moveSelection(
  columns: BoardColumns,
  current: GridPosition | null,
  direction: GridDirection,
): GridPosition | null {
  if (current === null || columns[current.column].length === 0) {
    return firstNonEmpty(columns);
  }

  if (direction === 'up' || direction === 'down') {
    const length = columns[current.column].length;
    const nextIndex = direction === 'up' ? current.index - 1 : current.index + 1;
    if (nextIndex < 0 || nextIndex >= length) return current;
    return { column: current.column, index: nextIndex };
  }

  const currentColumnIndex = COLUMN_ORDER.indexOf(current.column);
  const step = direction === 'left' ? -1 : 1;
  for (let i = currentColumnIndex + step; i >= 0 && i < COLUMN_ORDER.length; i += step) {
    const column = COLUMN_ORDER[i];
    if (column === undefined) break;
    if (columns[column].length > 0) {
      return { column, index: Math.min(current.index, columns[column].length - 1) };
    }
  }
  return current;
}
