import { useEffect, useId, useState } from 'react';
import styled from 'styled-components';
import { validateToken } from '../github/client';
import { tokens } from './theme';

export type TokenValidator = (
  token: string,
) => Promise<{ ok: true; login: string } | { ok: false; error: string }>;

export type SettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  hasToken: boolean;
  onSave: (token: string) => void;
  onClear: () => void;
  validate?: TokenValidator;
};

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(1, 4, 9, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
`;

const Panel = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${tokens.space(3)};
  width: min(560px, calc(100vw - 32px));
  padding: ${tokens.space(5)};
  background: ${tokens.color.surface};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  font-family: ${tokens.font.body};
  color: ${tokens.color.text};
`;

const Label = styled.label`
  font-size: 13px;
  font-weight: 600;
`;

const Input = styled.input`
  padding: ${tokens.space(2)} ${tokens.space(3)};
  background: ${tokens.color.background};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  color: ${tokens.color.text};
  font-family: ${tokens.font.mono};
  font-size: 13px;
`;

const Hint = styled.p`
  margin: 0;
  font-size: 12px;
  color: ${tokens.color.textMuted};
`;

const Message = styled.p<{ $tone: string }>`
  margin: 0;
  font-size: 12px;
  color: ${(props) => props.$tone};
`;

const Actions = styled.div`
  display: flex;
  gap: ${tokens.space(2)};
  justify-content: flex-end;
`;

const Button = styled.button`
  padding: ${tokens.space(2)} ${tokens.space(4)};
  background: ${tokens.color.surfaceRaised};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  color: ${tokens.color.text};
  font-family: ${tokens.font.body};
  font-size: 13px;
  cursor: pointer;

  &:hover {
    border-color: ${tokens.color.accent};
  }
`;

const Spacer = styled.span`
  flex: 1;
`;

export function SettingsDialog({
  open,
  onClose,
  hasToken,
  onSave,
  onClear,
  validate = validateToken,
}: SettingsDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inputId = useId();

  useEffect(() => {
    if (!open) {
      setValue('');
      setError(null);
      setLogin(null);
      setChecking(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = value.trim();
    if (token === '') {
      setError('Enter a token.');
      return;
    }

    setChecking(true);
    setError(null);
    setLogin(null);
    // Validating here means a typo is caught at entry, not at the next poll.
    const outcome = await validate(token);
    setChecking(false);

    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setLogin(outcome.login);
    onSave(token);
  };

  return (
    <Backdrop onClick={onClose}>
      <Panel
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <Label htmlFor={inputId}>GitHub personal access token</Label>
        <Input
          id={inputId}
          type="password"
          autoFocus
          autoComplete="off"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
        <Hint>
          Needs the <code>repo</code> scope for private repositories, and nothing at all for public
          ones. It is stored in this browser only.
        </Hint>
        {error === null ? null : (
          <Message role="alert" $tone={tokens.color.bad}>
            {error}
          </Message>
        )}
        {login === null ? null : (
          <Message $tone={tokens.color.good}>{`Token accepted for ${login}.`}</Message>
        )}
        <Actions>
          {hasToken ? (
            <Button type="button" onClick={onClear}>
              Clear token
            </Button>
          ) : null}
          <Spacer />
          <Button type="button" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" disabled={checking}>
            {checking ? 'Checking…' : 'Save'}
          </Button>
        </Actions>
      </Panel>
    </Backdrop>
  );
}
