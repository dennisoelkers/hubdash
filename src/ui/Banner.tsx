import styled from 'styled-components';
import { tokens } from './theme';

export type BannerProps = {
  tone: 'bad' | 'warn';
  children: React.ReactNode;
  onDismiss?: () => void;
};

const Wrapper = styled.div<{ $tone: string }>`
  display: flex;
  align-items: center;
  gap: ${tokens.space(3)};
  padding: ${tokens.space(2)} ${tokens.space(5)};
  background: ${(props) => props.$tone}22;
  border-bottom: 1px solid ${(props) => props.$tone};
  color: ${tokens.color.text};
  font-family: ${tokens.font.body};
  font-size: 13px;
`;

const Dismiss = styled.button`
  margin-left: auto;
  background: none;
  border: none;
  color: ${tokens.color.textMuted};
  cursor: pointer;
  font-size: 14px;

  &:hover {
    color: ${tokens.color.text};
  }
`;

export function Banner({ tone, children, onDismiss }: BannerProps) {
  return (
    <Wrapper
      role="alert"
      data-testid="banner"
      $tone={tone === 'bad' ? tokens.color.bad : tokens.color.warn}
    >
      <span>{children}</span>
      {onDismiss ? (
        <Dismiss type="button" aria-label="Dismiss" onClick={onDismiss}>
          ✕
        </Dismiss>
      ) : null}
    </Wrapper>
  );
}
