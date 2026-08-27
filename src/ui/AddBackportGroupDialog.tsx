import { useEffect, useId, useState } from 'react';
import styled from 'styled-components';
import { parseVersions } from '../domain/parseVersions';
import type { ParsedPr } from '../github/parseUrl';
import { parsePrUrl } from '../github/parseUrl';
import { tokens } from './theme';

export type AddBackportGroupDialogProps = {
  open: boolean;
  onClose: () => void;
  onAdd: (main: ParsedPr, versions: string[]) => { added: boolean; key: string };
  initialUrl?: string;
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
  width: min(520px, calc(100vw - 32px));
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

const Error = styled.p`
  margin: 0;
  font-size: 12px;
  color: ${tokens.color.bad};
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: ${tokens.space(2)};
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

export function AddBackportGroupDialog({ open, onClose, onAdd, initialUrl }: AddBackportGroupDialogProps) {
  const [url, setUrl] = useState('');
  const [versions, setVersions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const urlId = useId();
  const versionsId = useId();

  useEffect(() => {
    if (open) {
      setUrl(initialUrl ?? '');
    } else {
      setUrl('');
      setVersions('');
      setError(null);
    }
  }, [open, initialUrl]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parsePrUrl(url);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    // A duplicate is not an error: the caller flashes the existing group.
    onAdd(parsed.value, parseVersions(versions));
    onClose();
  };

  return (
    <Backdrop onClick={onClose}>
      <Panel
        role="dialog"
        aria-modal="true"
        aria-label="Track backports"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <Label htmlFor={urlId}>Main pull request</Label>
        <Input
          id={urlId}
          autoFocus={initialUrl === undefined}
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setError(null);
          }}
          placeholder="https://github.com/owner/repo/pull/123"
        />
        <Label htmlFor={versionsId}>Backport to</Label>
        <Input
          id={versionsId}
          autoFocus={initialUrl !== undefined}
          value={versions}
          onChange={(event) => setVersions(event.target.value)}
          placeholder="6.2, 6.1, 6.0"
        />
        <Hint>Comma separated. You can add or remove versions later.</Hint>
        {error === null ? null : <Error role="alert">{error}</Error>}
        <Actions>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Track</Button>
        </Actions>
      </Panel>
    </Backdrop>
  );
}
