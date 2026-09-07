import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { prKey } from '../domain/prKey';
import type { IssueEntry, PrEntry, PrKey, TrackedTask } from '../types';
import { TaskRow } from './TaskRow';
import { tokens } from './theme';

export type TaskArchiveSectionProps = {
  tasks: TrackedTask[];
  entries: Map<PrKey, PrEntry | IssueEntry>;
  flashedKey: PrKey | null;
  onRemoveTask: (key: PrKey) => void;
};

const Wrapper = styled.section`
  border-top: 1px solid ${tokens.color.border};
  padding-top: ${tokens.space(3)};
`;

const Toggle = styled.button`
  display: flex;
  align-items: center;
  gap: ${tokens.space(2)};
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: ${tokens.font.body};
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${tokens.color.textMuted};

  &:hover {
    color: ${tokens.color.text};
  }
`;

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${tokens.space(2)};
  margin-top: ${tokens.space(3)};
`;

/**
 * Collapsed by default — a structural copy of `BackportGroupArchiveSection`.
 * Archiving is one-way (spec §2), so there is no un-archive control here,
 * only remove.
 */
export function TaskArchiveSection({
  tasks,
  entries,
  flashedKey,
  onRemoveTask,
}: TaskArchiveSectionProps) {
  const [expanded, setExpanded] = useState(false);

  // Same gap this pattern already fixed for Backports: a duplicate-add flash
  // on an already-archived task would otherwise be invisible inside a
  // collapsed section.
  useEffect(() => {
    if (
      flashedKey !== null &&
      tasks.some((task) => prKey(task.owner, task.repo, task.number) === flashedKey)
    ) {
      setExpanded(true);
    }
  }, [flashedKey, tasks]);

  if (tasks.length === 0) return null;

  return (
    <Wrapper data-testid="task-archive">
      <Toggle type="button" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        Archive
        <span>{tasks.length}</span>
      </Toggle>
      {expanded ? (
        <Rows>
          {tasks.map((task) => {
            const key = prKey(task.owner, task.repo, task.number);
            return (
              <TaskRow
                key={key}
                task={task}
                entry={entries.get(key)}
                flashed={key === flashedKey}
                archived
                onRemove={() => onRemoveTask(key)}
                onArchive={() => {}}
                onDragStart={() => {}}
                onDragOver={() => {}}
                onDrop={() => {}}
              />
            );
          })}
        </Rows>
      ) : null}
    </Wrapper>
  );
}
