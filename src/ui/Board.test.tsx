import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { groupIntoColumns } from '../domain/sort';
import { makePr } from '../test/makePr';
import type { ColumnId, PrEntry, TrackedPr } from '../types';
import { Board } from './Board';

const tracked: TrackedPr = {
  owner: 'Example',
  repo: 'example-server',
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
    render(<Board columns={emptyColumns()} onRemove={() => {}} onArchive={() => {}} />);
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
    render(<Board columns={columns} onRemove={() => {}} onArchive={() => {}} />);
    expect(
      within(screen.getByTestId('column-waiting')).getByTestId('column-count'),
    ).toHaveTextContent('2');
    expect(
      within(screen.getByTestId('column-needsAction')).getByTestId('column-count'),
    ).toHaveTextContent('1');
  });

  it('puts each card in the right column', () => {
    const columns = groupIntoColumns([
      entry({ number: 1 }),
      entry({ number: 2, ci: 'failure' }),
      entry({ number: 3, reviewDecision: 'APPROVED' }),
    ]);
    render(<Board columns={columns} onRemove={() => {}} onArchive={() => {}} />);
    expect(within(screen.getByTestId('column-waiting')).getByText('#1')).toBeInTheDocument();
    expect(within(screen.getByTestId('column-needsAction')).getByText('#2')).toBeInTheDocument();
    expect(within(screen.getByTestId('column-ready')).getByText('#3')).toBeInTheDocument();
  });

  it('shows an empty-state message in an empty column', () => {
    render(<Board columns={emptyColumns()} onRemove={() => {}} onArchive={() => {}} />);
    expect(
      within(screen.getByTestId('column-ready')).getByText(/nothing here/i),
    ).toBeInTheDocument();
  });

  it('draws a divider above the drafts in needs action', () => {
    const columns = groupIntoColumns([
      entry({ number: 1, ci: 'failure' }),
      entry({ number: 2, isDraft: true }),
    ]);
    render(<Board columns={columns} onRemove={() => {}} onArchive={() => {}} />);
    expect(
      within(screen.getByTestId('column-needsAction')).getByTestId('draft-divider'),
    ).toBeInTheDocument();
  });

  it('draws no divider when needs action has no drafts', () => {
    const columns = groupIntoColumns([entry({ number: 1, ci: 'failure' })]);
    render(<Board columns={columns} onRemove={() => {}} onArchive={() => {}} />);
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
    render(<Board columns={columns} onRemove={() => {}} onArchive={() => {}} />);
    expect(within(screen.getByTestId('column-needsAction')).getAllByTestId('pr-card')).toHaveLength(
      2,
    );
    expect(screen.queryByTestId('draft-divider')).not.toBeInTheDocument();
  });

  it('passes the remove callback through to cards', async () => {
    const onRemove = vi.fn();
    const columns = groupIntoColumns([entry({ number: 4821 })]);
    render(<Board columns={columns} onRemove={onRemove} onArchive={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /remove #4821/i }));
    expect(onRemove).toHaveBeenCalledWith('example/example-server#4821');
  });

  it('flashes only the card whose key matches', () => {
    const columns = groupIntoColumns([entry({ number: 1 }), entry({ number: 2 })]);
    render(
      <Board
        columns={columns}
        onRemove={() => {}}
        onArchive={() => {}}
        flashedKey="example/example-server#2"
      />,
    );
    const flashed = screen
      .getAllByTestId('pr-card')
      .filter((card) => card.getAttribute('data-flashed') === 'true');
    expect(flashed).toHaveLength(1);
    const [flashedCard] = flashed;
    if (!flashedCard) throw new Error('expected exactly one flashed card');
    expect(within(flashedCard).getByText('#2')).toBeInTheDocument();
  });
});

describe('ArchiveSection via Board', () => {
  it('starts collapsed, showing a count but no cards', () => {
    const columns = groupIntoColumns([entry({ number: 9, lifecycle: 'MERGED' })]);
    render(<Board columns={columns} onRemove={() => {}} onArchive={() => {}} />);
    expect(screen.getByRole('button', { name: /archive/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('#9')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /archive/i })).toHaveTextContent('1');
  });

  it('reveals its cards when expanded, and hides them again', async () => {
    const columns = groupIntoColumns([entry({ number: 9, lifecycle: 'MERGED' })]);
    render(<Board columns={columns} onRemove={() => {}} onArchive={() => {}} />);
    const toggle = screen.getByRole('button', { name: /archive/i });

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('#9')).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.queryByText('#9')).not.toBeInTheDocument();
  });

  it('is not rendered at all when nothing is archived', () => {
    render(<Board columns={emptyColumns()} onRemove={() => {}} onArchive={() => {}} />);
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
  });
});

describe('Board — archiving and selection', () => {
  it('passes the archive callback through to cards, hidden inside the archive section', async () => {
    const onArchive = vi.fn();
    const columns = groupIntoColumns([entry({ number: 4821 })]);
    render(<Board columns={columns} onRemove={() => {}} onArchive={onArchive} />);
    await userEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    expect(onArchive).toHaveBeenCalledWith('example/example-server#4821');
  });

  it('selects only the card whose key matches', () => {
    const columns = groupIntoColumns([entry({ number: 1 }), entry({ number: 2 })]);
    render(
      <Board
        columns={columns}
        onRemove={() => {}}
        onArchive={() => {}}
        selectedKey="example/example-server#2"
      />,
    );
    const selected = screen
      .getAllByTestId('pr-card')
      .filter((card) => card.getAttribute('data-selected') === 'true');
    expect(selected).toHaveLength(1);
    const [selectedCard] = selected;
    if (!selectedCard) throw new Error('expected exactly one selected card');
    expect(within(selectedCard).getByText('#2')).toBeInTheDocument();
  });

  it('never renders an Archive button inside the collapsed-then-expanded archive section', async () => {
    const columns = groupIntoColumns([entry({ number: 9, lifecycle: 'MERGED' })]);
    render(<Board columns={columns} onRemove={() => {}} onArchive={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /archive/i }));
    // The toggle itself is named "Archive N"; a per-card Archive button would
    // collide with an exact-match query, which is exactly what this guards.
    expect(screen.queryAllByRole('button', { name: /^archive$/i })).toHaveLength(0);
  });
});
