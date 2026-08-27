import { useState } from 'react';
import styled from 'styled-components';
import type { PrEntry, PrKey } from '../types';
import { PrCard } from './PrCard';
import { tokens } from './theme';

export type ArchiveSectionProps = {
  entries: PrEntry[];
  onRemove: (key: PrKey) => void;
};

const Wrapper = styled.section`
  border-top: 1px solid ${tokens.color.border};
  padding-top: ${tokens.space(3)};
`;

const Toggle = styled.button`
  display: flex;
  align-items: center;
  gap: ${tokens.space(2)};
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: ${tokens.font.body};
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${tokens.color.textMuted};

  &:hover {
    color: ${tokens.color.text};
  }
`;

const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: ${tokens.space(2)};
  margin-top: ${tokens.space(3)};
`;

/** Collapsed by default. The state is per-session by design — see Task 11 note. */
export function ArchiveSection({ entries, onRemove }: ArchiveSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) return null;

  return (
    <Wrapper data-testid="archive">
      <Toggle type="button" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        Archive
        <span>{entries.length}</span>
      </Toggle>
      {expanded ? (
        <Cards>
          {entries.map((entry) => (
            <PrCard key={entry.key} entry={entry} onRemove={onRemove} />
          ))}
        </Cards>
      ) : null}
    </Wrapper>
  );
}
