import styled from 'styled-components';
import { groupKey, orderGroups } from '../domain/backports';
import type { ParsedPr } from '../github/parseUrl';
import type { BackportGroup, PrEntry, PrKey } from '../types';
import { BackportGroupCard } from './BackportGroupCard';
import { Empty } from './Empty';
import { tokens } from './theme';

export type BackportsTabProps = {
  groups: BackportGroup[];
  entries: Map<PrKey, PrEntry>;
  hasToken: boolean;
  /** Forwarded to the cards; see `BackportGroupCard`'s own prop. */
  flashedKey: PrKey | null;
  onRemoveGroup: (key: PrKey) => void;
  onAddVersion: (key: PrKey, version: string) => void;
  onRemoveVersion: (key: PrKey, version: string) => void;
  onFillSlot: (key: PrKey, version: string, pr: ParsedPr) => { ok: true } | { ok: false; error: string };
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
  onRemoveGroup,
  onAddVersion,
  onRemoveVersion,
  onFillSlot,
}: BackportsTabProps) {
  if (!hasToken) {
    return <Empty>Add a GitHub token in settings to start tracking backports.</Empty>;
  }
  if (groups.length === 0) {
    return <Empty>Track a pull request's backports — use the button above.</Empty>;
  }

  return (
    <List>
      {orderGroups(groups, entries).map((group) => {
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
          />
        );
      })}
    </List>
  );
}
