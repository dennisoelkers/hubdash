import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { groupIntoColumns } from '../domain/sort';
import { makePr } from '../test/makePr';
import type { ColumnId, PrEntry, TrackedPr } from '../types';
import { Board } from './Board';

const tracked: TrackedPr = {
  owner: 'Graylog2',
  repo: 'graylog2-server',
  number: 1,
  addedAt: '2026-08-27T09:00:00Z',
};

function entry(overrides: Parameters<typeof makePr>[0] = {}): PrEntry {
  const pr = makePr(overrides);
  return { status: 'ok', key: pr.key, tracked: { ...tracked, number: pr.number }, pr };
}

function emptyColumns(): Record<ColumnId, PrEntry[]> {
  return { waiting: [], needsAction: [], ready: [], archive: [] };
}

describe('Board', () => {
  it('renders all three columns with their titles', () => {
    render(<Board columns={emptyColumns()} onRemove={() => {}} />);
    expect(screen.getByRole('heading', { name: /waiting/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /needs action/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /ready/i })).toBeInTheDocument();
  });

  it('shows a count per column', () => {
    const columns = groupIntoColumns([
      entry({ number: 1 }),
      entry({ number: 2 }),
      entry({ number: 3, ci: 'failure' }),
    ]);
    render(<Board columns={columns} onRemove={() => {}} />);
    expect(within(screen.getByTestId('column-waiting')).getByTestId('column-count')).toHaveTextContent('2');
    expect(within(screen.getByTestId('column-needsAction')).getByTestId('column-count')).toHaveTextContent('1');
  });

  it('puts each card in the right column', () => {
    const columns = groupIntoColumns([
      entry({ number: 1 }),
      entry({ number: 2, ci: 'failure' }),
      entry({ number: 3, reviewDecision: 'APPROVED' }),
    ]);
    render(<Board columns={columns} onRemove={() => {}} />);
    expect(within(screen.getByTestId('column-waiting')).getByText('#1')).toBeInTheDocument();
    expect(within(screen.getByTestId('column-needsAction')).getByText('#2')).toBeInTheDocument();
    expect(within(screen.getByTestId('column-ready')).getByText('#3')).toBeInTheDocument();
  });

  it('shows an empty-state message in an empty column', () => {
    render(<Board columns={emptyColumns()} onRemove={() => {}} />);
    expect(within(screen.getByTestId('column-ready')).getByText(/nothing here/i)).toBeInTheDocument();
  });

  it('draws a divider above the drafts in needs action', () => {
    const columns = groupIntoColumns([
      entry({ number: 1, ci: 'failure' }),
      entry({ number: 2, isDraft: true }),
    ]);
    render(<Board columns={columns} onRemove={() => {}} />);
    expect(within(screen.getByTestId('column-needsAction')).getByTestId('draft-divider')).toBeInTheDocument();
  });

  it('draws no divider when needs action has no drafts', () => {
    const columns = groupIntoColumns([entry({ number: 1, ci: 'failure' })]);
    render(<Board columns={columns} onRemove={() => {}} />);
    expect(screen.queryByTestId('draft-divider')).not.toBeInTheDocument();
  });

  it('draws no divider when every entry in needs action is a draft', () => {
    // Covers the `> 0` half of the divider condition: an all-drafts column has
    // its first draft at index 0, and a divider above the very first card would
    // be meaningless. Not an exotic state — it is any user whose open work is
    // all WIP branches.
    const columns = groupIntoColumns([
      entry({ number: 1, isDraft: true }),
      entry({ number: 2, isDraft: true }),
    ]);
    render(<Board columns={columns} onRemove={() => {}} />);
    expect(
      within(screen.getByTestId('column-needsAction')).getAllByTestId('pr-card'),
    ).toHaveLength(2);
    expect(screen.queryByTestId('draft-divider')).not.toBeInTheDocument();
  });

  it('passes the remove callback through to cards', async () => {
    const onRemove = vi.fn();
    const columns = groupIntoColumns([entry({ number: 4821 })]);
    render(<Board columns={columns} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: /remove #4821/i }));
    expect(onRemove).toHaveBeenCalledWith('graylog2/graylog2-server#4821');
  });

  it('flashes only the card whose key matches', () => {
    const columns = groupIntoColumns([entry({ number: 1 }), entry({ number: 2 })]);
    render(
      <Board columns={columns} onRemove={() => {}} flashedKey="graylog2/graylog2-server#2" />,
    );
    const flashed = screen.getAllByTestId('pr-card').filter(
      (card) => card.getAttribute('data-flashed') === 'true',
    );
    expect(flashed).toHaveLength(1);
    const [flashedCard] = flashed;
    if (!flashedCard) throw new Error('expected exactly one flashed card');
    expect(within(flashedCard).getByText('#2')).toBeInTheDocument();
  });
});

describe('ArchiveSection via Board', () => {
  it('starts collapsed, showing a count but no cards', () => {
    const columns = groupIntoColumns([entry({ number: 9, lifecycle: 'MERGED' })]);
    render(<Board columns={columns} onRemove={() => {}} />);
    expect(screen.getByRole('button', { name: /archive/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('#9')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /archive/i })).toHaveTextContent('1');
  });

  it('reveals its cards when expanded, and hides them again', async () => {
    const columns = groupIntoColumns([entry({ number: 9, lifecycle: 'MERGED' })]);
    render(<Board columns={columns} onRemove={() => {}} />);
    const toggle = screen.getByRole('button', { name: /archive/i });

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('#9')).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.queryByText('#9')).not.toBeInTheDocument();
  });

  it('is not rendered at all when nothing is archived', () => {
    render(<Board columns={emptyColumns()} onRemove={() => {}} />);
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
  });
});
