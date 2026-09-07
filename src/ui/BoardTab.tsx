import type { ColumnId, PrEntry, PrKey } from '../types';
import { Board } from './Board';
import { Empty } from './Empty';

export type BoardTabProps = {
  columns: Record<ColumnId, PrEntry[]>;
  /** True when nothing is tracked, so the board would render four empty columns. */
  isEmpty: boolean;
  flashedKey: PrKey | null;
  selectedKey: PrKey | null;
  onRemove: (key: PrKey) => void;
  onArchive: (key: PrKey) => void;
};

/**
 * The board tab's content: the tracked pull requests, or a prompt to add one.
 * Deliberately free of any decision — grouping and ordering happen in
 * `domain/sort.ts` before anything reaches here.
 */
export function BoardTab({
  columns,
  isEmpty,
  flashedKey,
  selectedKey,
  onRemove,
  onArchive,
}: BoardTabProps) {
  if (isEmpty) {
    return <Empty>Add a pull request — use the button, paste a URL, or drop a link here.</Empty>;
  }
  return (
    <Board
      columns={columns}
      onRemove={onRemove}
      onArchive={onArchive}
      flashedKey={flashedKey}
      selectedKey={selectedKey}
    />
  );
}
