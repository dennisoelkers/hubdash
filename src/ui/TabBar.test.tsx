import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TabBar } from './TabBar';

describe('TabBar', () => {
  it('shows both tabs with their counts', () => {
    render(<TabBar active="board" onChange={() => {}} boardCount={3} backportsCount={2} />);
    expect(screen.getByRole('tab', { name: /pull requests/i })).toHaveTextContent('3');
    expect(screen.getByRole('tab', { name: /backports/i })).toHaveTextContent('2');
  });

  it('marks the active tab selected', () => {
    render(<TabBar active="backports" onChange={() => {}} boardCount={0} backportsCount={0} />);
    expect(screen.getByRole('tab', { name: /backports/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: /pull requests/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('calls onChange with the clicked tab', async () => {
    const onChange = vi.fn();
    render(<TabBar active="board" onChange={onChange} boardCount={0} backportsCount={0} />);
    await userEvent.click(screen.getByRole('tab', { name: /backports/i }));
    expect(onChange).toHaveBeenCalledWith('backports');
  });
});
