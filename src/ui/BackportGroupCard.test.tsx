import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makePr } from '../test/makePr';
import type { BackportGroup, PrEntry, PrKey } from '../types';
import { BackportGroupCard } from './BackportGroupCard';

function tracked(number: number) {
  return { owner: 'Graylog2', repo: 'graylog2-server', number, addedAt: '2026-08-01T00:00:00Z' };
}

function entryMap(...specs: Array<[number, 'OPEN' | 'CLOSED' | 'MERGED']>): Map<PrKey, PrEntry> {
  const map = new Map<PrKey, PrEntry>();
  for (const [number, lifecycle] of specs) {
    const pr = makePr({ number, lifecycle, title: `Fix ${number}` });
    map.set(pr.key, { status: 'ok', key: pr.key, tracked: tracked(number), pr });
  }
  return map;
}

function group(overrides: Partial<BackportGroup> = {}): BackportGroup {
  return {
    main: tracked(4821),
    slots: [
      { version: '6.2', pr: tracked(4840) },
      { version: '6.1', pr: null },
    ],
    addedAt: '2026-08-20T00:00:00Z',
    ...overrides,
  };
}

function setup(overrides: Partial<Parameters<typeof BackportGroupCard>[0]> = {}) {
  const props = {
    group: group(),
    entries: entryMap([4821, 'MERGED'], [4840, 'MERGED']),
    onRemoveGroup: vi.fn(),
    onAddVersion: vi.fn(),
    onRemoveVersion: vi.fn(),
    onFillSlot: vi.fn().mockReturnValue({ ok: true }),
    ...overrides,
  };
  render(<BackportGroupCard {...props} />);
  return props;
}

describe('BackportGroupCard — display', () => {
  it('shows the main PR number, title and repo', () => {
    setup();
    expect(screen.getByText('#4821')).toBeInTheDocument();
    expect(screen.getByText('Fix 4821')).toBeInTheDocument();
    expect(screen.getByText('Graylog2/graylog2-server')).toBeInTheDocument();
  });

  it('shows the roll-up as N of M landed', () => {
    setup();
    expect(screen.getByText('1 of 2 landed')).toBeInTheDocument();
  });

  it('shows zero of zero for a group with no versions', () => {
    setup({ group: group({ slots: [] }) });
    expect(screen.getByText('0 of 0 landed')).toBeInTheDocument();
  });

  it('renders one row per slot', () => {
    setup();
    expect(screen.getByText('6.2')).toBeInTheDocument();
    expect(screen.getByText('6.1')).toBeInTheDocument();
  });

  it('dims a fully-landed group', () => {
    setup({
      group: group({ slots: [{ version: '6.2', pr: tracked(4840) }] }),
      entries: entryMap([4821, 'MERGED'], [4840, 'MERGED']),
    });
    expect(screen.getByTestId('backport-group-card')).toHaveAttribute('data-complete', 'true');
  });

  it('flashes when its own key is the flashed one', () => {
    setup({ flashedKey: 'graylog2/graylog2-server#4821' });
    expect(screen.getByTestId('backport-group-card')).toHaveAttribute('data-flashed', 'true');
  });

  it('does not flash for another group’s key', () => {
    setup({ flashedKey: 'graylog2/graylog2-server#4790' });
    expect(screen.getByTestId('backport-group-card')).toHaveAttribute('data-flashed', 'false');
  });

  it('does not flash when nothing is flashed', () => {
    setup();
    expect(screen.getByTestId('backport-group-card')).toHaveAttribute('data-flashed', 'false');
  });

  it('does not dim an incomplete group', () => {
    setup();
    expect(screen.getByTestId('backport-group-card')).toHaveAttribute('data-complete', 'false');
  });
});

describe('BackportGroupCard — actions', () => {
  it('calls onRemoveGroup', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /remove group/i }));
    expect(props.onRemoveGroup).toHaveBeenCalled();
  });

  it('adds one version from the input', async () => {
    const props = setup();
    await userEvent.type(screen.getByLabelText(/add version/i), '6.0{Enter}');
    expect(props.onAddVersion).toHaveBeenCalledWith('6.0');
  });

  it('adds multiple comma-separated versions from one submit', async () => {
    const props = setup();
    await userEvent.type(screen.getByLabelText(/add version/i), '6.0, 5.2{Enter}');
    expect(props.onAddVersion).toHaveBeenNthCalledWith(1, '6.0');
    expect(props.onAddVersion).toHaveBeenNthCalledWith(2, '5.2');
  });

  it('clears the input after adding', async () => {
    setup();
    const input = screen.getByLabelText(/add version/i);
    await userEvent.type(input, '6.0{Enter}');
    expect(input).toHaveValue('');
  });

  it('does not submit an empty or blank input', async () => {
    const props = setup();
    await userEvent.type(screen.getByLabelText(/add version/i), '   {Enter}');
    expect(props.onAddVersion).not.toHaveBeenCalled();
  });

  it('passes fillSlot and removeVersion through to the right slot row', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /remove 6\.1/i }));
    expect(props.onRemoveVersion).toHaveBeenCalledWith('6.1');
  });
});
