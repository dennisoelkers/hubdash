import { describe, expect, it } from 'vitest';
import { moveSelection, positionOf } from './gridNav';
import type { BoardColumns } from './gridNav';

const columns: BoardColumns = {
  waiting: ['a#1', 'a#2', 'a#3'],
  needsAction: ['a#4'],
  ready: [],
};

describe('positionOf', () => {
  it('finds a key in whichever column holds it', () => {
    expect(positionOf(columns, 'a#2')).toEqual({ column: 'waiting', index: 1 });
    expect(positionOf(columns, 'a#4')).toEqual({ column: 'needsAction', index: 0 });
  });

  it('returns null for a key not present in any column', () => {
    expect(positionOf(columns, 'a#99')).toBeNull();
  });

  it('returns null for a null key', () => {
    expect(positionOf(columns, null)).toBeNull();
  });
});

describe('moveSelection — nothing selected yet', () => {
  it('selects the first item of the first non-empty column', () => {
    expect(moveSelection(columns, null, 'down')).toEqual({ column: 'waiting', index: 0 });
  });

  it('returns null when every column is empty', () => {
    const empty: BoardColumns = { waiting: [], needsAction: [], ready: [] };
    expect(moveSelection(empty, null, 'down')).toBeNull();
  });
});

describe('moveSelection — up/down within a column', () => {
  it('moves down within the column', () => {
    expect(moveSelection(columns, { column: 'waiting', index: 0 }, 'down')).toEqual({
      column: 'waiting',
      index: 1,
    });
  });

  it('moves up within the column', () => {
    expect(moveSelection(columns, { column: 'waiting', index: 2 }, 'up')).toEqual({
      column: 'waiting',
      index: 1,
    });
  });

  it('does not wrap past the bottom', () => {
    expect(moveSelection(columns, { column: 'waiting', index: 2 }, 'down')).toEqual({
      column: 'waiting',
      index: 2,
    });
  });

  it('does not wrap past the top', () => {
    expect(moveSelection(columns, { column: 'waiting', index: 0 }, 'up')).toEqual({
      column: 'waiting',
      index: 0,
    });
  });
});

describe('moveSelection — left/right across columns', () => {
  it('moves right to the next column, landing on the same row', () => {
    expect(moveSelection(columns, { column: 'waiting', index: 1 }, 'right')).toEqual({
      column: 'needsAction',
      index: 0,
    });
  });

  it('clamps the landing row to the target column\'s last item', () => {
    expect(moveSelection(columns, { column: 'waiting', index: 2 }, 'right')).toEqual({
      column: 'needsAction',
      index: 0,
    });
  });

  it('skips an empty column in the direction of travel', () => {
    // ready is empty, so right from needsAction has nowhere to land.
    expect(moveSelection(columns, { column: 'needsAction', index: 0 }, 'right')).toEqual({
      column: 'needsAction',
      index: 0,
    });
  });

  it('does not wrap past the left edge', () => {
    expect(moveSelection(columns, { column: 'waiting', index: 0 }, 'left')).toEqual({
      column: 'waiting',
      index: 0,
    });
  });

  it('moves left back across a skipped empty column', () => {
    const withGap: BoardColumns = { waiting: ['a#1'], needsAction: [], ready: ['a#2'] };
    expect(moveSelection(withGap, { column: 'ready', index: 0 }, 'left')).toEqual({
      column: 'waiting',
      index: 0,
    });
  });
});

describe('moveSelection — current names a now-empty or missing column', () => {
  it('falls back to the first non-empty column', () => {
    const shrunk: BoardColumns = { waiting: [], needsAction: ['a#4'], ready: [] };
    expect(moveSelection(shrunk, { column: 'waiting', index: 0 }, 'down')).toEqual({
      column: 'needsAction',
      index: 0,
    });
  });
});
