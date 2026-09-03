import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IssueEntry, PrEntry, PrKey, TrackedTask } from '../types';
import { TasksTab } from './TasksTab';

function task(number: number): TrackedTask {
  return { kind: 'pr', owner: 'a', repo: 'a', number, addedAt: '2026-08-27T09:00:00Z' };
}

describe('TasksTab — empty state', () => {
  it('shows the empty prompt when there are no tasks', () => {
    render(
      <TasksTab
        tasks={[]}
        entries={new Map()}
        flashedKey={null}
        onRemoveTask={() => {}}
        onReorder={() => {}}
      />,
    );
    expect(screen.getByText(/use the button, paste a url, or drop a link here/i)).toBeInTheDocument();
  });
});

describe('TasksTab — rendering', () => {
  it('renders one row per task, in stored order', () => {
    render(
      <TasksTab
        tasks={[task(1), task(2), task(3)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={() => {}}
        onReorder={() => {}}
      />,
    );
    const rows = screen.getAllByTestId('task-row');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('#1'),
      expect.stringContaining('#2'),
      expect.stringContaining('#3'),
    ]);
  });

  it('calls onRemoveTask with the right key', async () => {
    const onRemoveTask = vi.fn();
    render(
      <TasksTab
        tasks={[task(1)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={onRemoveTask}
        onReorder={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove #1/i }));
    expect(onRemoveTask).toHaveBeenCalledWith('a/a#1');
  });
});

describe('TasksTab — reordering', () => {
  it('calls onReorder with the source and target index on drop', () => {
    render(
      <TasksTab
        tasks={[task(1), task(2), task(3)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={() => {}}
        onReorder={(from, to) => {
          expect(from).toBe(0);
          expect(to).toBe(2);
        }}
      />,
    );
    const rows = screen.getAllByTestId('task-row');
    const first = rows[0];
    const third = rows[2];
    if (!first || !third) throw new Error('expected three rows');
    fireEvent.dragStart(first);
    fireEvent.dragOver(third);
    fireEvent.drop(third);
  });

  it('does not call onReorder when dropped on the same row it started from', () => {
    const onReorder = vi.fn();
    render(
      <TasksTab
        tasks={[task(1), task(2)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={() => {}}
        onReorder={onReorder}
      />,
    );
    const rows = screen.getAllByTestId('task-row');
    const first = rows[0];
    if (!first) throw new Error('expected a row');
    fireEvent.dragStart(first);
    fireEvent.drop(first);
    expect(onReorder).not.toHaveBeenCalled();
  });
});
