import { useId, useState } from 'react';
import styled from 'styled-components';
import { slotStateFor } from '../domain/backports';
import { textFrom } from '../domain/dropText';
import type { ParsedPr } from '../github/parseUrl';
import { parsePrUrl } from '../github/parseUrl';
import type { BackportSlot, PrEntry, PrKey } from '../types';
import { tokens } from './theme';

export type SlotRowProps = {
  slot: BackportSlot;
  entries: Map<PrKey, PrEntry>;
  onFill: (pr: ParsedPr) => { ok: true } | { ok: false; error: string };
  onRemoveVersion: () => void;
};

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: ${tokens.space(3)};
  padding: ${tokens.space(2)} 0;
  border-bottom: 1px solid ${tokens.color.border};
`;

const Version = styled.span`
  width: 3.5em;
  font-family: ${tokens.font.mono};
  color: ${tokens.color.textMuted};
  flex-shrink: 0;
`;

const Number = styled.a`
  font-family: ${tokens.font.mono};
  color: ${tokens.color.accent};
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const Status = styled.span<{ $tone: string }>`
  color: ${(props) => props.$tone};
  font-size: 13px;
`;

const Invitation = styled.span`
  color: ${tokens.color.textMuted};
  font-size: 13px;
  font-style: italic;
`;

const Spacer = styled.span`
  flex: 1;
`;

const IconButton = styled.button`
  background: none;
  border: none;
  color: ${tokens.color.textMuted};
  cursor: pointer;
  font-size: 13px;

  &:hover {
    color: ${tokens.color.text};
  }
`;

const Input = styled.input`
  flex: 1;
  padding: ${tokens.space(1)} ${tokens.space(2)};
  background: ${tokens.color.background};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  color: ${tokens.color.text};
  font-family: ${tokens.font.mono};
  font-size: 12px;
`;

const Error = styled.p`
  margin: ${tokens.space(1)} 0 0;
  font-size: 12px;
  color: ${tokens.color.bad};
`;

function statusOf(slot: BackportSlot, entries: Map<PrKey, PrEntry>) {
  const state = slotStateFor(slot, entries);
  switch (state.kind) {
    case 'merged':
      return { label: '✓ merged', tone: tokens.color.good };
    case 'open':
      return { label: '○ open', tone: tokens.color.textMuted };
    case 'closed':
      return { label: '✖ closed, not merged', tone: tokens.color.bad };
    case 'errored':
      return { label: state.message, tone: tokens.color.bad };
    case 'pending':
      return { label: '… pending', tone: tokens.color.textMuted };
    case 'empty':
      return null;
  }
}

export function SlotRow({ slot, entries, onFill, onRemoveVersion }: SlotRowProps) {
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputId = useId();

  const fill = (raw: string) => {
    const parsed = parsePrUrl(raw);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const outcome = onFill(parsed.value);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setError(null);
    setEditing(false);
    setValue('');
  };

  const status = statusOf(slot, entries);

  return (
    <div>
      <Row
        data-testid="slot-row"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const text = textFrom(event.dataTransfer);
          if (text !== '') fill(text);
        }}
      >
        <Version>{slot.version}</Version>
        {slot.pr === null ? null : (
          <Number
            href={`https://github.com/${slot.pr.owner}/${slot.pr.repo}/pull/${slot.pr.number}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            {`#${slot.pr.number}`}
          </Number>
        )}
        {status === null ? (
          <Invitation>drop a pull request link here</Invitation>
        ) : (
          <Status $tone={status.tone}>{status.label}</Status>
        )}
        <Spacer />
        {editing ? null : (
          <IconButton type="button" aria-label="Add a link" onClick={() => setEditing(true)}>
            {slot.pr === null ? '+ link' : 'replace'}
          </IconButton>
        )}
        <IconButton
          type="button"
          aria-label={`Remove ${slot.version}`}
          onClick={onRemoveVersion}
        >
          ✕
        </IconButton>
      </Row>
      {editing ? (
        <Row as="form" onSubmit={(event) => { event.preventDefault(); fill(value); }}>
          <label htmlFor={inputId} style={{ position: 'absolute', left: '-9999px' }}>
            Pull request URL
          </label>
          <Input
            id={inputId}
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="https://github.com/owner/repo/pull/123"
          />
        </Row>
      ) : null}
      {error === null ? null : <Error role="alert">{error}</Error>}
    </div>
  );
}
