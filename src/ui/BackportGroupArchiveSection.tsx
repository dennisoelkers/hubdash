import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { groupKey } from '../domain/backports';
import type { ParsedPr } from '../github/parseUrl';
import type { BackportGroup, PrEntry, PrKey } from '../types';
import { BackportGroupCard } from './BackportGroupCard';
import { tokens } from './theme';

export type BackportGroupArchiveSectionProps = {
  groups: BackportGroup[];
  entries: Map<PrKey, PrEntry>;
  flashedKey: PrKey | null;
  onRemoveGroup: (key: PrKey) => void;
  onAddVersion: (key: PrKey, version: string) => void;
  onRemoveVersion: (key: PrKey, version: string) => void;
  onFillSlot: (key: PrKey, version: string, pr: ParsedPr) => { ok: true } | { ok: false; error: string };
  onArchiveGroup: (key: PrKey) => void;
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
  display: flex;
  flex-direction: column;
  gap: ${tokens.space(3)};
  margin-top: ${tokens.space(3)};
`;

/** Collapsed by default — a structural copy of the board's `ArchiveSection`. */
export function BackportGroupArchiveSection({
  groups,
  entries,
  flashedKey,
  onRemoveGroup,
  onAddVersion,
  onRemoveVersion,
  onFillSlot,
  onArchiveGroup,
}: BackportGroupArchiveSectionProps) {
  const [expanded, setExpanded] = useState(false);

  // Spec round 2 gap found in final review: a duplicate-add flash on an
  // already-archived group would otherwise be invisible inside a collapsed
  // section. Once revealed, stays revealed — snapping shut when the flash
  // times out 1.5s later would be worse than not revealing it at all.
  useEffect(() => {
    if (flashedKey !== null && groups.some((group) => groupKey(group) === flashedKey)) {
      setExpanded(true);
    }
  }, [flashedKey, groups]);

  if (groups.length === 0) return null;

  return (
    <Wrapper data-testid="backport-archive">
      <Toggle type="button" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        Archive
        <span>{groups.length}</span>
      </Toggle>
      {expanded ? (
        <Cards>
          {groups.map((group) => {
            const key = groupKey(group);
            return (
              <BackportGroupCard
                key={key}
                group={group}
                entries={entries}
                flashedKey={flashedKey}
                onRemoveGroup={() => onRemoveGroup(key)}
                onAddVersion={(version) => onAddVersion(key, version)}
                onRemoveVersion={(version) => onRemoveVersion(key, version)}
                onFillSlot={(version, pr) => onFillSlot(key, version, pr)}
                onArchiveGroup={() => onArchiveGroup(key)}
              />
            );
          })}
        </Cards>
      ) : null}
    </Wrapper>
  );
}
