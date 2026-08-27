import { useState } from 'react';
import styled from 'styled-components';
import { groupKey, isComplete, prStateFor, rollUpFor } from '../domain/backports';
import { parseVersions } from '../domain/parseVersions';
import { prKey } from '../domain/prKey';
import type { ParsedPr } from '../github/parseUrl';
import type { BackportGroup, PrEntry, PrKey } from '../types';
import { SlotRow } from './SlotRow';
import { tokens } from './theme';

export type BackportGroupCardProps = {
  group: BackportGroup;
  entries: Map<PrKey, PrEntry>;
  onRemoveGroup: () => void;
  onAddVersion: (version: string) => void;
  onRemoveVersion: (version: string) => void;
  onFillSlot: (version: string, pr: ParsedPr) => { ok: true } | { ok: false; error: string };
  /**
   * The group to signal, if any. Spec §10.5: re-adding an already-tracked main
   * PR flashes the existing card rather than creating a second one.
   */
  flashedKey?: PrKey | null;
};

const Card = styled.article`
  padding: ${tokens.space(3)} ${tokens.space(4)};
  background: ${tokens.color.surface};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  font-family: ${tokens.font.body};
  color: ${tokens.color.text};

  &[data-complete='true'] {
    opacity: 0.6;
  }

  &[data-flashed='true'] {
    outline: 2px solid ${tokens.color.accent};
  }
`;

const Header = styled.div`
  display: flex;
  align-items: baseline;
  gap: ${tokens.space(2)};
`;

const NumberLabel = styled.span`
  font-family: ${tokens.font.mono};
  color: ${tokens.color.textMuted};
`;

const Title = styled.span`
  font-weight: 600;
  flex: 1;
`;

const RollUp = styled.span`
  font-size: 12px;
  color: ${tokens.color.textMuted};
`;

const RemoveGroup = styled.button`
  background: none;
  border: none;
  color: ${tokens.color.textMuted};
  cursor: pointer;

  &:hover {
    color: ${tokens.color.bad};
  }
`;

const Meta = styled.div`
  font-size: 12px;
  color: ${tokens.color.textMuted};
  margin-bottom: ${tokens.space(2)};
`;

const MainStatus = styled.span`
  font-size: 13px;
  color: ${tokens.color.textMuted};
`;

const AddVersionInput = styled.input`
  margin-top: ${tokens.space(2)};
  width: 100%;
  padding: ${tokens.space(1)} ${tokens.space(2)};
  background: ${tokens.color.background};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  color: ${tokens.color.text};
  font-family: ${tokens.font.mono};
  font-size: 12px;
`;

function mainLabel(state: ReturnType<typeof prStateFor>): string {
  switch (state.kind) {
    case 'merged':
      return '✓ merged';
    case 'open':
      return '○ open';
    case 'closed':
      return '✖ closed, not merged';
    case 'errored':
      return state.message;
    case 'pending':
      return '… pending';
    case 'empty':
      return '';
  }
}

export function BackportGroupCard({
  group,
  entries,
  onRemoveGroup,
  onAddVersion,
  onRemoveVersion,
  onFillSlot,
  flashedKey = null,
}: BackportGroupCardProps) {
  const [versionInput, setVersionInput] = useState('');
  const { landed, total } = rollUpFor(group, entries);
  const mainKey = `${group.main.owner}/${group.main.repo}`;
  const mainEntry = entries.get(prKey(group.main.owner, group.main.repo, group.main.number));
  const mainTitle = mainEntry?.status === 'ok' ? mainEntry.pr.title : '';

  const submitVersions = (event: React.FormEvent) => {
    event.preventDefault();
    for (const version of parseVersions(versionInput)) {
      onAddVersion(version);
    }
    setVersionInput('');
  };

  return (
    <Card
      data-testid="backport-group-card"
      data-complete={isComplete(group, entries) ? 'true' : 'false'}
      data-flashed={groupKey(group) === flashedKey ? 'true' : 'false'}
    >
      <Header>
        <NumberLabel>{`#${group.main.number}`}</NumberLabel>
        <Title>{mainTitle}</Title>
        <RollUp>{`${landed} of ${total} landed`}</RollUp>
        <RemoveGroup type="button" aria-label="Remove group" onClick={onRemoveGroup}>
          ✕
        </RemoveGroup>
      </Header>
      <Meta>
        {/* mainKey wrapped in its own element so it has an exact, matchable
            textContent — as a bare sibling text node next to MainStatus, no
            single element's textContent would equal just the repo string. */}
        <span>{mainKey}</span> · <MainStatus>{mainLabel(prStateFor(group.main, entries))}</MainStatus>
      </Meta>
      {group.slots.map((slot) => (
        <SlotRow
          key={slot.version}
          slot={slot}
          entries={entries}
          onFill={(pr) => onFillSlot(slot.version, pr)}
          onRemoveVersion={() => onRemoveVersion(slot.version)}
        />
      ))}
      <form onSubmit={submitVersions}>
        <label htmlFor={`add-version-${group.main.number}`} style={{ position: 'absolute', left: '-9999px' }}>
          Add version
        </label>
        <AddVersionInput
          id={`add-version-${group.main.number}`}
          value={versionInput}
          onChange={(event) => setVersionInput(event.target.value)}
          placeholder="+ version, e.g. 6.0 or 6.0, 5.2"
        />
      </form>
    </Card>
  );
}
