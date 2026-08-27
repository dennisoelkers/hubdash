import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

function setup(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const props = {
    onAdd: vi.fn(),
    onRefresh: vi.fn(),
    isPolling: false,
    freshness: { label: '4s ago', stale: false },
    rateLimit: { limit: 5000, cost: 1, remaining: 4812, resetAt: '2026-08-27T11:00:00Z' },
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  render(<TopBar {...props} />);
  return props;
}

describe('TopBar', () => {
  it('calls its handlers', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /add pr/i }));
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await userEvent.click(screen.getByRole('button', { name: /settings/i }));
    expect(props.onAdd).toHaveBeenCalled();
    expect(props.onRefresh).toHaveBeenCalled();
    expect(props.onOpenSettings).toHaveBeenCalled();
  });

  it('shows the freshness label', () => {
    setup();
    expect(screen.getByTestId('freshness')).toHaveTextContent('updated 4s ago');
  });

  it('marks stale freshness so it can be styled amber', () => {
    setup({ freshness: { label: '2m ago', stale: true } });
    expect(screen.getByTestId('freshness')).toHaveAttribute('data-stale', 'true');
  });

  it('says so when there has been no successful poll yet', () => {
    setup({ freshness: null });
    expect(screen.getByTestId('freshness')).toHaveTextContent(/never/i);
  });

  it('shows the remaining rate limit', () => {
    setup();
    expect(screen.getByTestId('rate-limit')).toHaveTextContent('4812');
  });

  it('omits the rate limit when unknown', () => {
    setup({ rateLimit: null });
    expect(screen.queryByTestId('rate-limit')).not.toBeInTheDocument();
  });

  it('disables refresh while a poll is in flight', () => {
    setup({ isPolling: true });
    expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
  });

  it('uses a custom add-button label when given one, defaulting to "+ Add PR"', () => {
    setup();
    expect(screen.getByRole('button', { name: '+ Add PR' })).toBeInTheDocument();
  });

  it('shows the given addLabel', () => {
    setup({ addLabel: '+ Track backports' });
    expect(screen.getByRole('button', { name: '+ Track backports' })).toBeInTheDocument();
  });
});
