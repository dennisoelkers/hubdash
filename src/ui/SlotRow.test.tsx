import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makePr } from '../test/makePr';
import type { BackportSlot, PrEntry, PrKey } from '../types';
import { SlotRow } from './SlotRow';

function tracked(number: number) {
  return { owner: 'Example', repo: 'example-server', number, addedAt: '2026-08-01T00:00:00Z' };
}

function entryMap(...specs: Array<[number, 'OPEN' | 'CLOSED' | 'MERGED']>): Map<PrKey, PrEntry> {
  const map = new Map<PrKey, PrEntry>();
  for (const [number, lifecycle] of specs) {
    const pr = makePr({ number, lifecycle });
    map.set(pr.key, { status: 'ok', key: pr.key, tracked: tracked(number), pr });
  }
  return map;
}

function dataTransfer(text: string): DataTransfer {
  return { types: ['text/plain'], getData: () => text } as unknown as DataTransfer;
}

const EMPTY: BackportSlot = { version: '6.0', pr: null };
const FILLED: BackportSlot = { version: '6.2', pr: tracked(4840) };

describe('SlotRow — display', () => {
  it('shows the version label and an invitation when empty', () => {
    render(
      <SlotRow
        slot={EMPTY}
        entries={new Map()}
        onFill={() => ({ ok: true })}
        onRemoveVersion={() => {}}
      />,
    );
    expect(screen.getByText('6.0')).toBeInTheDocument();
    expect(screen.getByText(/drop a pull request/i)).toBeInTheDocument();
  });

  it('shows pending when a PR is set but has no entry yet', () => {
    render(
      <SlotRow
        slot={FILLED}
        entries={new Map()}
        onFill={() => ({ ok: true })}
        onRemoveVersion={() => {}}
      />,
    );
    expect(screen.getByText('#4840')).toBeInTheDocument();
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });

  it('shows merged, open and closed from the entry', () => {
    const { rerender } = render(
      <SlotRow
        slot={FILLED}
        entries={entryMap([4840, 'MERGED'])}
        onFill={() => ({ ok: true })}
        onRemoveVersion={() => {}}
      />,
    );
    expect(screen.getByText(/merged/i)).toBeInTheDocument();

    rerender(
      <SlotRow
        slot={FILLED}
        entries={entryMap([4840, 'CLOSED'])}
        onFill={() => ({ ok: true })}
        onRemoveVersion={() => {}}
      />,
    );
    expect(screen.getByText(/closed, not merged/i)).toBeInTheDocument();
  });

  it('shows the GitHub message for an errored PR', () => {
    const map = new Map<PrKey, PrEntry>([
      [
        'example/example-server#4840',
        {
          status: 'error',
          key: 'example/example-server#4840',
          tracked: tracked(4840),
          message: 'Not found',
        },
      ],
    ]);
    render(
      <SlotRow
        slot={FILLED}
        entries={map}
        onFill={() => ({ ok: true })}
        onRemoveVersion={() => {}}
      />,
    );
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });

  it('links the PR number to GitHub', () => {
    render(
      <SlotRow
        slot={FILLED}
        entries={entryMap([4840, 'OPEN'])}
        onFill={() => ({ ok: true })}
        onRemoveVersion={() => {}}
      />,
    );
    expect(screen.getByRole('link', { name: '#4840' })).toHaveAttribute(
      'href',
      'https://github.com/Example/example-server/pull/4840',
    );
  });
});

describe('SlotRow — filling by drop', () => {
  it('parses a dropped URL and calls onFill with it', () => {
    const onFill = vi.fn().mockReturnValue({ ok: true });
    render(<SlotRow slot={EMPTY} entries={new Map()} onFill={onFill} onRemoveVersion={() => {}} />);
    const row = screen.getByTestId('slot-row');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(event, {
      dataTransfer: dataTransfer('https://github.com/Example/example-server/pull/4839'),
    });
    act(() => void row.dispatchEvent(event));
    expect(onFill).toHaveBeenCalledWith({ owner: 'Example', repo: 'example-server', number: 4839 });
  });

  it('shows a parse error inline without calling onFill', () => {
    const onFill = vi.fn();
    render(<SlotRow slot={EMPTY} entries={new Map()} onFill={onFill} onRemoveVersion={() => {}} />);
    const row = screen.getByTestId('slot-row');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: dataTransfer('https://gitlab.com/a/b/pull/1') });
    act(() => void row.dispatchEvent(event));
    expect(onFill).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/github\.com/i);
  });

  it('shows onFill’s rejection message when it refuses the PR', () => {
    const onFill = vi
      .fn()
      .mockReturnValue({ ok: false, error: 'That pull request is already filling the 6.1 slot.' });
    render(<SlotRow slot={EMPTY} entries={new Map()} onFill={onFill} onRemoveVersion={() => {}} />);
    const row = screen.getByTestId('slot-row');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(event, {
      dataTransfer: dataTransfer('https://github.com/Example/example-server/pull/4840'),
    });
    act(() => void row.dispatchEvent(event));
    expect(screen.getByRole('alert')).toHaveTextContent(/6\.1 slot/);
  });

  it('prevents the default on dragover so the browser allows the drop', () => {
    render(
      <SlotRow
        slot={EMPTY}
        entries={new Map()}
        onFill={() => ({ ok: true })}
        onRemoveVersion={() => {}}
      />,
    );
    const event = new Event('dragover', { bubbles: true, cancelable: true });
    screen.getByTestId('slot-row').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('stops the drop event from reaching the window', () => {
    const onFill = vi.fn().mockReturnValue({ ok: true });
    render(<SlotRow slot={EMPTY} entries={new Map()} onFill={onFill} onRemoveVersion={() => {}} />);
    const windowListener = vi.fn();
    window.addEventListener('drop', windowListener);
    try {
      const row = screen.getByTestId('slot-row');
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.assign(event, {
        dataTransfer: dataTransfer('https://github.com/Example/example-server/pull/4839'),
      });
      act(() => void row.dispatchEvent(event));
      expect(windowListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('drop', windowListener);
    }
  });
});

describe('SlotRow — filling by click-to-paste', () => {
  it('reveals a URL input on click and fills on submit', async () => {
    const onFill = vi.fn().mockReturnValue({ ok: true });
    render(<SlotRow slot={EMPTY} entries={new Map()} onFill={onFill} onRemoveVersion={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /add a link/i }));
    const input = screen.getByLabelText(/pull request url/i);
    await userEvent.type(input, 'https://github.com/Example/example-server/pull/4839{Enter}');
    expect(onFill).toHaveBeenCalledWith({ owner: 'Example', repo: 'example-server', number: 4839 });
  });

  it('labels the toggle for what it actually does', () => {
    const { rerender } = render(
      <SlotRow
        slot={EMPTY}
        entries={new Map()}
        onFill={() => ({ ok: true })}
        onRemoveVersion={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Add a link' })).toHaveTextContent('+ link');
    rerender(
      <SlotRow
        slot={FILLED}
        entries={new Map()}
        onFill={() => ({ ok: true })}
        onRemoveVersion={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Replace the link' })).toHaveTextContent('replace');
  });

  it('closes the editor again without filling anything', async () => {
    const onFill = vi.fn();
    render(<SlotRow slot={EMPTY} entries={new Map()} onFill={onFill} onRemoveVersion={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /add a link/i }));
    await userEvent.type(screen.getByLabelText(/pull request url/i), 'half a url');

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByLabelText(/pull request url/i)).not.toBeInTheDocument();
    expect(onFill).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add a link' })).toBeInTheDocument();
  });

  it('closes the editor on Escape too', async () => {
    render(
      <SlotRow
        slot={EMPTY}
        entries={new Map()}
        onFill={() => ({ ok: true })}
        onRemoveVersion={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /add a link/i }));
    await userEvent.type(screen.getByLabelText(/pull request url/i), '{Escape}');
    expect(screen.queryByLabelText(/pull request url/i)).not.toBeInTheDocument();
  });

  it('forgets a shown error once the user edits the URL again', async () => {
    render(
      <SlotRow
        slot={EMPTY}
        entries={new Map()}
        onFill={() => ({ ok: true })}
        onRemoveVersion={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /add a link/i }));
    const input = screen.getByLabelText(/pull request url/i);
    await userEvent.type(input, 'https://gitlab.com/a/b/pull/1{Enter}');
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await userEvent.type(input, '2');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('forgets a shown error when the slot fills from somewhere else', () => {
    const { rerender } = render(
      <SlotRow
        slot={EMPTY}
        entries={new Map()}
        onFill={() => ({ ok: true })}
        onRemoveVersion={() => {}}
      />,
    );
    const row = screen.getByTestId('slot-row');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: dataTransfer('https://gitlab.com/a/b/pull/1') });
    act(() => void row.dispatchEvent(event));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <SlotRow
        slot={{ version: '6.0', pr: tracked(4839) }}
        entries={new Map()}
        onFill={() => ({ ok: true })}
        onRemoveVersion={() => {}}
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('SlotRow — removing a version', () => {
  it('calls onRemoveVersion, without confirmation', async () => {
    const onRemoveVersion = vi.fn();
    render(
      <SlotRow
        slot={EMPTY}
        entries={new Map()}
        onFill={() => ({ ok: true })}
        onRemoveVersion={onRemoveVersion}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /remove 6\.0/i }));
    expect(onRemoveVersion).toHaveBeenCalled();
  });
});
