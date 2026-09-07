import styled from 'styled-components';
import { groupKey, orderGroups } from '../domain/backports';
import type { ParsedPr } from '../github/parseUrl';
import type { BackportGroup, PrEntry, PrKey } from '../types';
import { BackportGroupArchiveSection } from './BackportGroupArchiveSection';
import { BackportGroupCard } from './BackportGroupCard';
import { Empty } from './Empty';
import { tokens } from './theme';

export type BackportsTabProps = {
  groups: BackportGroup[];
  entries: Map<PrKey, PrEntry>;
  hasToken: boolean;
  /** Forwarded to the cards; see `BackportGroupCard`'s own prop. */
  flashedKey: PrKey | null;
  selectedKey?: PrKey | null;
  onRemoveGroup: (key: PrKey) => void;
  onAddVersion: (key: PrKey, version: string) => void;
  onRemoveVersion: (key: PrKey, version: string) => void;
  onFillSlot: (
    key: PrKey,
    version: string,
    pr: ParsedPr,
  ) => { ok: true } | { ok: false; error: string };
  onArchiveGroup: (key: PrKey) => void;
};

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${tokens.space(3)};
  padding: ${tokens.space(5)};
`;

export function BackportsTab({
  groups,
  entries,
  hasToken,
  flashedKey,
  selectedKey = null,
  onRemoveGroup,
  onAddVersion,
  onRemoveVersion,
  onFillSlot,
  onArchiveGroup,
}: BackportsTabProps) {
  if (!hasToken) {
    return <Empty>Add a GitHub token in settings to start tracking backports.</Empty>;
  }
  if (groups.length === 0) {
    return (
      <Empty>
        Track a pull request's backports — use the button, paste a URL, or drop a link here.
      </Empty>
    );
  }

  const active = groups.filter((group) => !group.archived);
  const archived = groups.filter((group) => group.archived);

  return (
    <List>
      {orderGroups(active, entries).map((group) => {
        const key = groupKey(group);
        return (
          <BackportGroupCard
            key={key}
            group={group}
            entries={entries}
            flashedKey={flashedKey}
            selected={key === selectedKey}
            onRemoveGroup={() => onRemoveGroup(key)}
            onAddVersion={(version) => onAddVersion(key, version)}
            onRemoveVersion={(version) => onRemoveVersion(key, version)}
            onFillSlot={(version, pr) => onFillSlot(key, version, pr)}
            onArchiveGroup={() => onArchiveGroup(key)}
          />
        );
      })}
      <BackportGroupArchiveSection
        groups={archived}
        entries={entries}
        flashedKey={flashedKey}
        onRemoveGroup={onRemoveGroup}
        onAddVersion={onAddVersion}
        onRemoveVersion={onRemoveVersion}
        onFillSlot={onFillSlot}
        onArchiveGroup={onArchiveGroup}
      />
    </List>
  );
}
