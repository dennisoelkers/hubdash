import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TabBar } from './TabBar';

describe('TabBar', () => {
  it('shows all three tabs with their counts', () => {
    render(
      <TabBar
        active="board"
        onChange={() => {}}
        boardCount={3}
        backportsCount={2}
        tasksCount={5}
      />,
    );
    expect(screen.getByRole('tab', { name: /pull requests/i })).toHaveTextContent('3');
    expect(screen.getByRole('tab', { name: /backports/i })).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /^tasks/i })).toHaveTextContent('5');
  });

  it('marks the active tab selected', () => {
    render(
      <TabBar
        active="tasks"
        onChange={() => {}}
        boardCount={0}
        backportsCount={0}
        tasksCount={0}
      />,
    );
    expect(screen.getByRole('tab', { name: /^tasks/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /pull requests/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('tab', { name: /backports/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('calls onChange with the clicked tab', async () => {
    const onChange = vi.fn();
    render(
      <TabBar
        active="board"
        onChange={onChange}
        boardCount={0}
        backportsCount={0}
        tasksCount={0}
      />,
    );
    await userEvent.click(screen.getByRole('tab', { name: /backports/i }));
    expect(onChange).toHaveBeenCalledWith('backports');
    await userEvent.click(screen.getByRole('tab', { name: /^tasks/i }));
    expect(onChange).toHaveBeenCalledWith('tasks');
  });
});
