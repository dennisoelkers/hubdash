import styled from 'styled-components';
import type { ColumnId, PrEntry, PrKey } from '../types';
import { PrCard } from './PrCard';
import { tokens } from './theme';

export const COLUMN_TITLES: Record<ColumnId, string> = {
  waiting: 'Waiting',
  needsAction: 'Needs action',
  ready: 'Ready',
  archive: 'Archive',
};

export type ColumnProps = {
  id: ColumnId;
  entries: PrEntry[];
  onRemove: (key: PrKey) => void;
  flashedKey?: PrKey | null;
};

const Wrapper = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${tokens.space(2)};
  min-width: 0;
`;

const Heading = styled.h2`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0;
  padding-bottom: ${tokens.space(2)};
  border-bottom: 1px solid ${tokens.color.border};
  font-family: ${tokens.font.body};
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${tokens.color.textMuted};
`;

const Count = styled.span`
  font-family: ${tokens.font.mono};
`;

const Cards = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${tokens.space(2)};
`;

const Empty = styled.p`
  margin: 0;
  font-family: ${tokens.font.body};
  font-size: 12px;
  color: ${tokens.color.textMuted};
`;

const DraftDivider = styled.hr`
  margin: ${tokens.space(1)} 0;
  border: none;
  border-top: 1px dashed ${tokens.color.border};
`;

function isDraft(entry: PrEntry): boolean {
  return entry.status === 'ok' && entry.pr.isDraft;
}

export function Column({ id, entries, onRemove, flashedKey = null }: ColumnProps) {
  // sort.ts has already put drafts last, so the first draft marks the boundary.
  const firstDraftIndex = entries.findIndex(isDraft);
  const showDivider = id === 'needsAction' && firstDraftIndex > 0;

  return (
    <Wrapper data-testid={`column-${id}`}>
      <Heading>
        {COLUMN_TITLES[id]}
        <Count data-testid="column-count">{entries.length}</Count>
      </Heading>
      {entries.length === 0 ? (
        <Empty>Nothing here.</Empty>
      ) : (
        <Cards>
          {entries.map((entry, index) => (
            <div key={entry.key}>
              {showDivider && index === firstDraftIndex ? (
                <DraftDivider data-testid="draft-divider" />
              ) : null}
              <PrCard entry={entry} onRemove={onRemove} flashed={entry.key === flashedKey} />
            </div>
          ))}
        </Cards>
      )}
    </Wrapper>
  );
}
