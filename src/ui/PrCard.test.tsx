import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makePr } from '../test/makePr';
import type { PrEntry, TrackedPr } from '../types';
import { PrCard } from './PrCard';

const tracked: TrackedPr = {
  owner: 'Example',
  repo: 'example-server',
  number: 4821,
  addedAt: '2026-08-27T09:00:00Z',
};

function okEntry(overrides: Parameters<typeof makePr>[0] = {}): PrEntry {
  const pr = makePr(overrides);
  return { status: 'ok', key: pr.key, tracked, pr };
}

const errorEntry: PrEntry = {
  status: 'error',
  key: 'example/example-server#4821',
  tracked,
  message: 'Could not resolve to a Repository with the name.',
};

describe('PrCard — a resolved PR', () => {
  it('shows the number, title, repository and author', () => {
    render(<PrCard entry={okEntry()} onRemove={() => {}} />);
    expect(screen.getByText('#4821')).toBeInTheDocument();
    expect(screen.getByText('Fix index rotation')).toBeInTheDocument();
    expect(screen.getByText('Example/example-server')).toBeInTheDocument();
    expect(screen.getByText(/octocat/)).toBeInTheDocument();
  });

  it('links the title to the PR on GitHub, opening in a new tab', () => {
    render(<PrCard entry={okEntry()} onRemove={() => {}} />);
    const link = screen.getByRole('link', { name: /Fix index rotation/ });
    expect(link).toHaveAttribute('href', 'https://github.com/Example/example-server/pull/4821');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('renders every badge the PR earns', () => {
    render(
      <PrCard
        entry={okEntry({ reviewDecision: 'CHANGES_REQUESTED', ci: 'failure', failingCheckCount: 2 })}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText('✖ changes requested')).toBeInTheDocument();
    expect(screen.getByText('● 2 failing')).toBeInTheDocument();
  });

  it('renders no badges for a PR with nothing to report', () => {
    render(<PrCard entry={okEntry({ ci: 'none', reviewDecision: null })} onRemove={() => {}} />);
    expect(screen.queryByTestId('badge')).not.toBeInTheDocument();
  });

  it('marks a draft card so it can be styled down', () => {
    render(<PrCard entry={okEntry({ isDraft: true })} onRemove={() => {}} />);
    expect(screen.getByTestId('pr-card')).toHaveAttribute('data-draft', 'true');
    expect(screen.getByText('⊘ draft')).toBeInTheDocument();
  });

  it('calls onRemove with the key when the remove control is used', async () => {
    const onRemove = vi.fn();
    render(<PrCard entry={okEntry()} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: /remove #4821/i }));
    expect(onRemove).toHaveBeenCalledWith('example/example-server#4821');
  });

  it('marks a flashed card so a duplicate add can draw the eye', () => {
    render(<PrCard entry={okEntry()} onRemove={() => {}} flashed />);
    expect(screen.getByTestId('pr-card')).toHaveAttribute('data-flashed', 'true');
  });
});

describe('PrCard — flashing a duplicate', () => {
  /**
   * jsdom implements no layout, so `scrollIntoView` is simply absent from
   * HTMLElement — which is exactly why the component has to guard the call, and
   * why a test that wants to observe it has to install one.
   */
  function withScrollIntoView(): { calls: Array<unknown>; restore: () => void } {
    const calls: Array<unknown> = [];
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const had = 'scrollIntoView' in proto;
    proto.scrollIntoView = (options?: unknown) => void calls.push(options);
    return {
      calls,
      restore: () => {
        if (!had) delete proto.scrollIntoView;
      },
    };
  }

  it('scrolls a flashed card into view (spec §7.4)', () => {
    const scroll = withScrollIntoView();
    try {
      render(<PrCard entry={okEntry()} onRemove={() => {}} flashed />);
      expect(scroll.calls).toHaveLength(1);
    } finally {
      scroll.restore();
    }
  });

  it('does not scroll a card that is not flashed', () => {
    const scroll = withScrollIntoView();
    try {
      render(<PrCard entry={okEntry()} onRemove={() => {}} />);
      expect(scroll.calls).toHaveLength(0);
    } finally {
      scroll.restore();
    }
  });

  it('renders a flashed card where scrollIntoView does not exist', () => {
    // The default jsdom environment: no scrollIntoView at all. An unguarded
    // call would take out the card, and with it the board.
    expect(() =>
      render(<PrCard entry={okEntry()} onRemove={() => {}} flashed />),
    ).not.toThrow();
  });
});

describe('PrCard — an unresolved PR', () => {
  it('shows the identity it knows and the reason it failed', () => {
    render(<PrCard entry={errorEntry} onRemove={() => {}} />);
    expect(screen.getByText('#4821')).toBeInTheDocument();
    expect(screen.getByText('Example/example-server')).toBeInTheDocument();
    expect(screen.getByText(/Could not resolve to a Repository/)).toBeInTheDocument();
  });

  it('still offers a remove control, which is the usual fix', async () => {
    const onRemove = vi.fn();
    render(<PrCard entry={errorEntry} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: /remove #4821/i }));
    expect(onRemove).toHaveBeenCalledWith('example/example-server#4821');
  });

  it('marks the card as errored', () => {
    render(<PrCard entry={errorEntry} onRemove={() => {}} />);
    expect(screen.getByTestId('pr-card')).toHaveAttribute('data-status', 'error');
  });
});
