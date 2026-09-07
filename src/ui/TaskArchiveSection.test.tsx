import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IssueEntry, PrEntry, PrKey, TrackedTask } from '../types';
import { TaskArchiveSection } from './TaskArchiveSection';

function task(number: number): TrackedTask {
  return { kind: 'pr', owner: 'a', repo: 'a', number, addedAt: '2026-08-27T09:00:00Z' };
}

describe('TaskArchiveSection', () => {
  it('renders nothing when there are no archived tasks', () => {
    render(
      <TaskArchiveSection
        tasks={[]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
  });

  it('starts collapsed, showing a count but no rows', () => {
    render(
      <TaskArchiveSection
        tasks={[task(1)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={() => {}}
      />,
    );
    const toggle = screen.getByRole('button', { name: /archive/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('1');
    expect(screen.queryByTestId('task-row')).not.toBeInTheDocument();
  });

  it('reveals its rows when expanded, and hides them again', async () => {
    render(
      <TaskArchiveSection
        tasks={[task(1)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={() => {}}
      />,
    );
    const toggle = screen.getByRole('button', { name: /archive/i });

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('task-row')).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.queryByTestId('task-row')).not.toBeInTheDocument();
  });

  it('expands automatically when the flashed task is inside it', () => {
    render(
      <TaskArchiveSection
        tasks={[task(1)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey="a/a#1"
        onRemoveTask={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /archive/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('still offers remove on an archived row', async () => {
    const onRemoveTask = vi.fn();
    render(
      <TaskArchiveSection
        tasks={[task(1)]}
        entries={new Map<PrKey, PrEntry | IssueEntry>()}
        flashedKey={null}
        onRemoveTask={onRemoveTask}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /archive/i }));
    await userEvent.click(screen.getByRole('button', { name: /remove #1/i }));
    expect(onRemoveTask).toHaveBeenCalledWith('a/a#1');
  });
});
