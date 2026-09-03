import { useState } from 'react';
import styled from 'styled-components';
import { taskStatusFor } from '../domain/taskStatus';
import type { IssueEntry, PrEntry, TrackedTask } from '../types';
import { tokens } from './theme';

export type TaskRowProps = {
  task: TrackedTask;
  entry: PrEntry | IssueEntry | undefined;
  flashed: boolean;
  onRemove: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
};

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: ${tokens.space(3)};
  padding: ${tokens.space(2)} ${tokens.space(3)};
  background: ${tokens.color.surface};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius};
  font-family: ${tokens.font.body};
  color: ${tokens.color.text};

  &[data-flashed='true'] {
    outline: 2px solid ${tokens.color.accent};
  }

  &[data-dragging='true'] {
    opacity: 0.4;
  }
`;

const Handle = styled.span`
  cursor: grab;
  color: ${tokens.color.textMuted};
  flex-shrink: 0;
`;

const NumberLink = styled.a`
  font-family: ${tokens.font.mono};
  color: ${tokens.color.accent};
  text-decoration: none;
  flex-shrink: 0;

  &:hover {
    text-decoration: underline;
  }
`;

const Title = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Meta = styled.span`
  font-size: 12px;
  color: ${tokens.color.textMuted};
  flex-shrink: 0;
`;

const Status = styled.span<{ $tone: string }>`
  font-size: 13px;
  color: ${(props) => props.$tone};
  flex-shrink: 0;
`;

const RemoveButton = styled.button`
  background: none;
  border: none;
  color: ${tokens.color.textMuted};
  cursor: pointer;
  font-size: 14px;
  flex-shrink: 0;

  &:hover {
    color: ${tokens.color.bad};
  }
`;

function statusView(entry: PrEntry | IssueEntry | undefined): { label: string; tone: string } {
  const status = taskStatusFor(entry);
  switch (status.kind) {
    case 'pending':
      return { label: '… pending', tone: tokens.color.textMuted };
    case 'errored':
      return { label: status.message, tone: tokens.color.bad };
    case 'waiting':
      return { label: '◌ waiting', tone: tokens.color.textMuted };
    case 'needsAction':
      return { label: '⚠ needs action', tone: tokens.color.bad };
    case 'ready':
      return { label: '✓ ready', tone: tokens.color.good };
    case 'merged':
      return { label: '✓ merged', tone: tokens.color.good };
    case 'closed':
      return { label: '✖ closed', tone: tokens.color.bad };
  }
}

// Empty rather than a placeholder like `#N`, which would just repeat the
// NumberLink right next to it — the row has nothing else to say about a
// task before its poll data arrives.
function titleOf(entry: PrEntry | IssueEntry | undefined): string {
  if (entry?.status !== 'ok') return '';
  return 'pr' in entry ? entry.pr.title : entry.issue.title;
}

function urlOf(task: TrackedTask, entry: PrEntry | IssueEntry | undefined): string {
  if (entry?.status === 'ok') return 'pr' in entry ? entry.pr.url : entry.issue.url;
  const segment = task.kind === 'issue' ? 'issues' : 'pull';
  return `https://github.com/${task.owner}/${task.repo}/${segment}/${task.number}`;
}

function nameWithOwnerOf(task: TrackedTask, entry: PrEntry | IssueEntry | undefined): string {
  if (entry?.status === 'ok')
    return 'pr' in entry ? entry.pr.nameWithOwner : entry.issue.nameWithOwner;
  return `${task.owner}/${task.repo}`;
}

export function TaskRow({
  task,
  entry,
  flashed,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
}: TaskRowProps) {
  const [dragging, setDragging] = useState(false);
  const status = statusView(entry);

  return (
    <Row
      data-testid="task-row"
      data-flashed={flashed ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      draggable
      onDragStart={() => {
        setDragging(true);
        onDragStart();
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      <Handle aria-hidden="true">⋮⋮</Handle>
      <NumberLink href={urlOf(task, entry)} target="_blank" rel="noreferrer noopener">
        {`#${task.number}`}
      </NumberLink>
      <Title>{titleOf(entry)}</Title>
      <Meta>{nameWithOwnerOf(task, entry)}</Meta>
      <Status $tone={status.tone}>{status.label}</Status>
      <RemoveButton
        type="button"
        aria-label={`Remove #${task.number} from tasks`}
        onClick={onRemove}
      >
        ✕
      </RemoveButton>
    </Row>
  );
}
