import { useRef } from 'react';
import styled from 'styled-components';
import { prKey } from '../domain/prKey';
import type { IssueEntry, PrEntry, PrKey, TrackedTask } from '../types';
import { Empty } from './Empty';
import { TaskArchiveSection } from './TaskArchiveSection';
import { TaskRow } from './TaskRow';
import { tokens } from './theme';

export type TasksTabProps = {
  tasks: TrackedTask[];
  archivedKeys: PrKey[];
  entries: Map<PrKey, PrEntry | IssueEntry>;
  flashedKey: PrKey | null;
  selectedKey?: PrKey | null;
  onRemoveTask: (key: PrKey) => void;
  onArchive: (key: PrKey) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
};

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${tokens.space(2)};
  padding: ${tokens.space(5)};
`;

export function TasksTab({
  tasks,
  archivedKeys,
  entries,
  flashedKey,
  selectedKey = null,
  onRemoveTask,
  onArchive,
  onReorder,
}: TasksTabProps) {
  // A ref, not state: the dragged index is read only inside the drop
  // handler it triggers synchronously, and does not need to drive a render.
  const dragIndex = useRef<number | null>(null);

  if (tasks.length === 0) {
    return (
      <Empty>Add an issue or pull request — use the button, paste a URL, or drop a link here.</Empty>
    );
  }

  const archivedKeySet = new Set(archivedKeys);
  const active = tasks.filter(
    (task) => !archivedKeySet.has(prKey(task.owner, task.repo, task.number)),
  );
  const archived = tasks.filter((task) =>
    archivedKeySet.has(prKey(task.owner, task.repo, task.number)),
  );

  return (
    <List>
      {active.map((task, index) => {
        const key = prKey(task.owner, task.repo, task.number);
        return (
          <TaskRow
            key={key}
            task={task}
            entry={entries.get(key)}
            flashed={key === flashedKey}
            selected={key === selectedKey}
            onRemove={() => onRemoveTask(key)}
            onArchive={() => onArchive(key)}
            onDragStart={() => {
              dragIndex.current = index;
            }}
            onDragOver={() => {}}
            onDrop={() => {
              const from = dragIndex.current;
              dragIndex.current = null;
              if (from !== null && from !== index) onReorder(from, index);
            }}
          />
        );
      })}
      <TaskArchiveSection
        tasks={archived}
        entries={entries}
        flashedKey={flashedKey}
        onRemoveTask={onRemoveTask}
      />
    </List>
  );
}
