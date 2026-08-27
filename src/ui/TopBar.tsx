import styled from 'styled-components';
import type { RateLimit } from '../types';
import { tokens } from './theme';

export type TopBarProps = {
  onAdd: () => void;
  /** Context-sensitive: the active tab decides what the add button offers. */
  addLabel?: string;
  onRefresh: () => void;
  isPolling: boolean;
  freshness: { label: string; stale: boolean } | null;
  rateLimit: RateLimit | null;
  onOpenSettings: () => void;
};

const Wrapper = styled.header`
  display: flex;
  align-items: center;
  gap: ${tokens.space(4)};
  padding: ${tokens.space(3)} ${tokens.space(5)};
  border-bottom: 1px solid ${tokens.color.border};
  font-family: ${tokens.font.body};
  color: ${tokens.color.text};
`;

const Brand = styled.h1`
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
`;

const Spacer = styled.span`
  flex: 1;
`;

const Muted = styled.span`
  font-size: 12px;
  color: ${tokens.color.textMuted};
  font-family: ${tokens.font.mono};

  &[data-stale='true'] {
    color: ${tokens.color.warn};
  }
`;

const Button = styled.button`
  padding: ${tokens.space(1)} ${tokens.space(3)};
  background: ${tokens.color.surfaceRaised};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  color: ${tokens.color.text};
  font-family: ${tokens.font.body};
  font-size: 13px;
  cursor: pointer;

  &:hover:enabled {
    border-color: ${tokens.color.accent};
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

export function TopBar({
  onAdd,
  addLabel = '+ Add PR',
  onRefresh,
  isPolling,
  freshness,
  rateLimit,
  onOpenSettings,
}: TopBarProps) {
  return (
    <Wrapper>
      <Brand>hubdash</Brand>
      <Button type="button" onClick={onAdd}>
        {addLabel}
      </Button>
      <Spacer />
      <Muted data-testid="freshness" data-stale={freshness?.stale ? 'true' : 'false'}>
        {freshness === null ? 'never updated' : `updated ${freshness.label}`}
      </Muted>
      <Button type="button" aria-label="Refresh" onClick={onRefresh} disabled={isPolling}>
        ↻
      </Button>
      {rateLimit === null ? null : (
        <Muted data-testid="rate-limit" title="Remaining GraphQL rate-limit points">
          {`${rateLimit.remaining} ⚡`}
        </Muted>
      )}
      <Button type="button" aria-label="Settings" onClick={onOpenSettings}>
        ⚙
      </Button>
    </Wrapper>
  );
}
