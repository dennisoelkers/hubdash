import { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { badgesFor } from '../domain/badges';
import type { PrEntry, PrKey } from '../types';
import { toneColor, tokens } from './theme';

export type PrCardProps = {
  entry: PrEntry;
  onRemove: (key: PrKey) => void;
  onArchive: (key: PrKey) => void;
  flashed?: boolean;
  archived?: boolean;
  selected?: boolean;
};

const Card = styled.article`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: ${tokens.space(1)};
  padding: ${tokens.space(2)} ${tokens.space(3)};
  background: ${tokens.color.surface};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  font-family: ${tokens.font.body};
  color: ${tokens.color.text};

  &[data-draft='true'] {
    opacity: 0.6;
    border-style: dashed;
  }

  &[data-status='error'] {
    border-color: ${tokens.color.bad};
  }

  &[data-flashed='true'] {
    outline: 2px solid ${tokens.color.accent};
  }

  &[data-selected='true'] {
    background: ${tokens.color.accent}1a;
  }

  &:hover button[data-remove='true'] {
    opacity: 1;
  }
`;

const Header = styled.div`
  display: flex;
  align-items: baseline;
  gap: ${tokens.space(2)};
`;

const Number = styled.span`
  font-family: ${tokens.font.mono};
  color: ${tokens.color.textMuted};
  flex-shrink: 0;
`;

const TitleLink = styled.a`
  color: ${tokens.color.text};
  text-decoration: none;
  font-weight: 600;

  &:hover {
    color: ${tokens.color.accent};
    text-decoration: underline;
  }
`;

const Meta = styled.div`
  display: flex;
  gap: ${tokens.space(2)};
  font-size: 12px;
  color: ${tokens.color.textMuted};
`;

const BadgeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${tokens.space(1)};
`;

const BadgeChip = styled.span<{ $tone: string }>`
  font-size: 11px;
  font-family: ${tokens.font.mono};
  color: ${(props) => props.$tone};
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 0 ${tokens.space(2)};
  white-space: nowrap;
`;

const ErrorText = styled.p`
  margin: 0;
  font-size: 12px;
  color: ${tokens.color.bad};
`;

const Spacer = styled.span`
  flex: 1;
`;

const ArchiveButton = styled.button`
  padding: ${tokens.space(1)} ${tokens.space(2)};
  /* Clears RemoveButton's absolutely-positioned corner footprint — see the
     arithmetic in the Task 5 fix report. Without this, the two buttons'
     bounding boxes overlap and a hover meant for Archive can reveal Remove. */
  margin-right: ${tokens.space(6)};
  background: none;
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  color: ${tokens.color.textMuted};
  font-family: ${tokens.font.body};
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    color: ${tokens.color.text};
    border-color: ${tokens.color.accent};
  }
`;

const RemoveButton = styled.button`
  position: absolute;
  top: ${tokens.space(1)};
  right: ${tokens.space(1)};
  opacity: 0;
  background: none;
  border: none;
  color: ${tokens.color.textMuted};
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: ${tokens.space(1)};

  &:focus-visible {
    opacity: 1;
  }

  &:hover {
    color: ${tokens.color.bad};
  }
`;

export function PrCard({
  entry,
  onRemove,
  onArchive,
  flashed = false,
  archived = false,
  selected = false,
}: PrCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);

  // Spec §7.4: adding a PR that is already tracked scrolls the existing card
  // into view AND flashes it. Flashing alone is no answer when the card is
  // three columns down and off the bottom of the window — the user is told
  // nothing happened and shown nothing.
  useEffect(() => {
    if (!flashed) return;
    const card = cardRef.current;
    // Guarded rather than assumed: scrollIntoView is layout-dependent and not
    // present in every environment the component renders in (jsdom has none).
    if (typeof card?.scrollIntoView !== 'function') return;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [flashed]);

  const isDraft = entry.status === 'ok' && entry.pr.isDraft;
  const nameWithOwner =
    entry.status === 'ok' ? entry.pr.nameWithOwner : `${entry.tracked.owner}/${entry.tracked.repo}`;
  const number = entry.status === 'ok' ? entry.pr.number : entry.tracked.number;

  return (
    <Card
      ref={cardRef}
      data-testid="pr-card"
      data-status={entry.status}
      data-draft={isDraft ? 'true' : 'false'}
      data-flashed={flashed ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
    >
      <RemoveButton
        data-remove="true"
        type="button"
        aria-label={`Remove #${number} from the board`}
        onClick={() => onRemove(entry.key)}
      >
        ✕
      </RemoveButton>

      <Header>
        <Number>{`#${number}`}</Number>
        {entry.status === 'ok' ? (
          <TitleLink href={entry.pr.url} target="_blank" rel="noreferrer noopener">
            {entry.pr.title}
          </TitleLink>
        ) : null}
        <Spacer />
        {archived ? null : (
          <ArchiveButton type="button" onClick={() => onArchive(entry.key)}>
            Archive
          </ArchiveButton>
        )}
      </Header>

      <Meta>
        <span>{nameWithOwner}</span>
        {entry.status === 'ok' ? <span>{entry.pr.author}</span> : null}
      </Meta>

      {entry.status === 'error' ? <ErrorText>{entry.message}</ErrorText> : null}

      {entry.status === 'ok' ? (
        <BadgeRow>
          {badgesFor(entry.pr).map((badge) => (
            <BadgeChip key={badge.kind} data-testid="badge" $tone={toneColor(badge.tone)}>
              {badge.label}
            </BadgeChip>
          ))}
        </BadgeRow>
      ) : null}
    </Card>
  );
}
