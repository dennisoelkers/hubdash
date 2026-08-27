import styled from 'styled-components';
import { badgesFor } from '../domain/badges';
import type { PrEntry, PrKey } from '../types';
import { toneColor, tokens } from './theme';

export type PrCardProps = {
  entry: PrEntry;
  onRemove: (key: PrKey) => void;
  flashed?: boolean;
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

export function PrCard({ entry, onRemove, flashed = false }: PrCardProps) {
  const isDraft = entry.status === 'ok' && entry.pr.isDraft;
  const nameWithOwner =
    entry.status === 'ok'
      ? entry.pr.nameWithOwner
      : `${entry.tracked.owner}/${entry.tracked.repo}`;
  const number = entry.status === 'ok' ? entry.pr.number : entry.tracked.number;

  return (
    <Card
      data-testid="pr-card"
      data-status={entry.status}
      data-draft={isDraft ? 'true' : 'false'}
      data-flashed={flashed ? 'true' : 'false'}
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
