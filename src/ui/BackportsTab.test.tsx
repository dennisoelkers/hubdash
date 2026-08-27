import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makePr } from '../test/makePr';
import type { BackportGroup, PrEntry, PrKey } from '../types';
import { BackportsTab } from './BackportsTab';

function tracked(number: number) {
  return { owner: 'Graylog2', repo: 'graylog2-server', number, addedAt: '2026-08-01T00:00:00Z' };
}

function group(mainNumber: number, addedAt: string, overrides: Partial<BackportGroup> = {}): BackportGroup {
  return { main: tracked(mainNumber), slots: [], addedAt, archived: false, ...overrides };
}

function entryMap(...specs: Array<[number, 'OPEN' | 'CLOSED' | 'MERGED']>): Map<PrKey, PrEntry> {
  const map = new Map<PrKey, PrEntry>();
  for (const [number, lifecycle] of specs) {
    const pr = makePr({ number, lifecycle });
    map.set(pr.key, { status: 'ok', key: pr.key, tracked: tracked(number), pr });
  }
  return map;
}

function baseProps(overrides: Partial<Parameters<typeof BackportsTab>[0]> = {}) {
  return {
    groups: [],
    entries: new Map<PrKey, PrEntry>(),
    hasToken: true,
    flashedKey: null,
    onRemoveGroup: vi.fn(),
    onAddVersion: vi.fn(),
    onRemoveVersion: vi.fn(),
    onFillSlot: vi.fn().mockReturnValue({ ok: true }),
    onArchiveGroup: vi.fn(),
    ...overrides,
  };
}

describe('BackportsTab', () => {
  it('prompts for a token when there is none', () => {
    render(<BackportsTab {...baseProps({ hasToken: false })} />);
    expect(screen.getByText(/add a github token/i)).toBeInTheDocument();
  });

  it('prompts to track a PR when there is a token but no groups', () => {
    render(<BackportsTab {...baseProps({ hasToken: true, groups: [] })} />);
    expect(screen.getByText(/track/i)).toBeInTheDocument();
  });

  it('renders one card per group, ordered by orderGroups', () => {
    const groups = [group(1, '2026-08-01T00:00:00Z'), group(2, '2026-08-20T00:00:00Z')];
    render(<BackportsTab {...baseProps({ groups })} />);
    const cards = screen.getAllByTestId('backport-group-card');
    expect(cards).toHaveLength(2);
    // Both are zero-slot, so orderGroups falls back to addedAt descending.
    expect(cards[0]).toHaveTextContent('#2');
    expect(cards[1]).toHaveTextContent('#1');
  });

  it('flashes only the group whose key is flashed', () => {
    const groups = [group(4821, '2026-08-01T00:00:00Z'), group(4790, '2026-08-20T00:00:00Z')];
    render(
      <BackportsTab {...baseProps({ groups, flashedKey: 'graylog2/graylog2-server#4821' })} />,
    );
    const flashed = screen
      .getAllByTestId('backport-group-card')
      .filter((card) => card.getAttribute('data-flashed') === 'true');
    expect(flashed).toHaveLength(1);
    expect(flashed[0]).toHaveTextContent('#4821');
  });

  it('routes onRemoveGroup with the right group key', async () => {
    const onRemoveGroup = vi.fn();
    render(<BackportsTab {...baseProps({ groups: [group(4821, '2026-08-20T00:00:00Z')], onRemoveGroup })} />);
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.click(screen.getByRole('button', { name: /remove group/i }));
    expect(onRemoveGroup).toHaveBeenCalledWith('graylog2/graylog2-server#4821');
  });
});

describe('BackportGroupArchiveSection via BackportsTab', () => {
  it('keeps an archived group out of the active list', () => {
    const groups = [
      group(1, '2026-08-01T00:00:00Z'),
      group(2, '2026-08-20T00:00:00Z', { archived: true }),
    ];
    render(<BackportsTab {...baseProps({ groups })} />);
    expect(screen.getAllByTestId('backport-group-card')).toHaveLength(1);
    expect(screen.getByTestId('backport-group-card')).toHaveTextContent('#1');
  });

  it('starts collapsed, showing a count but no cards', () => {
    const groups = [group(9, '2026-08-01T00:00:00Z', { archived: true })];
    render(<BackportsTab {...baseProps({ groups })} />);
    const toggle = screen.getByRole('button', { name: /archive/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('1');
    expect(screen.queryByText('#9')).not.toBeInTheDocument();
  });

  it('reveals its cards when expanded, and hides them again', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const groups = [group(9, '2026-08-01T00:00:00Z', { archived: true })];
    render(<BackportsTab {...baseProps({ groups })} />);
    const toggle = screen.getByRole('button', { name: /archive/i });

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('#9')).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.queryByText('#9')).not.toBeInTheDocument();
  });

  it('is not rendered at all when nothing is archived', () => {
    render(<BackportsTab {...baseProps({ groups: [group(1, '2026-08-01T00:00:00Z')] })} />);
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
  });

  it('routes onArchiveGroup with the right group key', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const onArchiveGroup = vi.fn();
    const groups = [
      group(4821, '2026-08-20T00:00:00Z', { slots: [{ version: '6.2', pr: tracked(4840) }] }),
    ];
    const entries = entryMap([4821, 'MERGED'], [4840, 'MERGED']);
    render(<BackportsTab {...baseProps({ groups, entries, onArchiveGroup })} />);
    await userEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    expect(onArchiveGroup).toHaveBeenCalledWith('graylog2/graylog2-server#4821');
  });
});
