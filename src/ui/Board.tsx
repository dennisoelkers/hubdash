import styled from 'styled-components';
import type { ColumnId, PrEntry, PrKey } from '../types';
import { ArchiveSection } from './ArchiveSection';
import { Column } from './Column';
import { tokens } from './theme';

export type BoardProps = {
  columns: Record<ColumnId, PrEntry[]>;
  onRemove: (key: PrKey) => void;
  onArchive: (key: PrKey) => void;
  flashedKey?: PrKey | null;
  selectedKey?: PrKey | null;
};

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${tokens.space(5)};
  padding: ${tokens.space(5)};
`;

const Columns = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: ${tokens.space(5)};

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const ORDER: ColumnId[] = ['waiting', 'needsAction', 'ready'];

export function Board({
  columns,
  onRemove,
  onArchive,
  flashedKey = null,
  selectedKey = null,
}: BoardProps) {
  return (
    <Wrapper>
      <Columns>
        {ORDER.map((id) => (
          <Column
            key={id}
            id={id}
            entries={columns[id]}
            onRemove={onRemove}
            onArchive={onArchive}
            flashedKey={flashedKey}
            selectedKey={selectedKey}
          />
        ))}
      </Columns>
      <ArchiveSection entries={columns.archive} onRemove={onRemove} onArchive={onArchive} />
    </Wrapper>
  );
}
