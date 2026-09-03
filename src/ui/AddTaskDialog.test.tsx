import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddTaskDialog } from './AddTaskDialog';

function setup(onAdd = vi.fn().mockReturnValue({ added: true, key: 'k' })) {
  const onClose = vi.fn();
  render(<AddTaskDialog open onClose={onClose} onAdd={onAdd} />);
  return { onAdd, onClose };
}

describe('AddTaskDialog', () => {
  it('renders nothing when closed', () => {
    render(<AddTaskDialog open={false} onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('adds a valid PR URL and closes', async () => {
    const { onAdd, onClose } = setup();
    await userEvent.type(
      screen.getByLabelText(/issue or pull request url/i),
      'https://github.com/Example/example-server/pull/4821',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(onAdd).toHaveBeenCalledWith({
      kind: 'pr',
      owner: 'Example',
      repo: 'example-server',
      number: 4821,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('adds a valid issue URL and closes', async () => {
    const { onAdd, onClose } = setup();
    await userEvent.type(
      screen.getByLabelText(/issue or pull request url/i),
      'https://github.com/Example/example-server/issues/55',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(onAdd).toHaveBeenCalledWith({
      kind: 'issue',
      owner: 'Example',
      repo: 'example-server',
      number: 55,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the parser error and does not add, for the owner/repo#N shorthand', async () => {
    const { onAdd, onClose } = setup();
    await userEvent.type(screen.getByLabelText(/issue or pull request url/i), 'Example/example-server#4821');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/full github link/i);
    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('tells nothing extra and still closes when the item is already tracked', async () => {
    const onAdd = vi.fn().mockReturnValue({ added: false, key: 'k' });
    const { onClose } = setup(onAdd);
    await userEvent.type(
      screen.getByLabelText(/issue or pull request url/i),
      'https://github.com/Example/example-server/pull/4821',
    );
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape and on Cancel', async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('resets the field when reopened', async () => {
    const { rerender } = render(
      <AddTaskDialog open onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />,
    );
    await userEvent.type(
      screen.getByLabelText(/issue or pull request url/i),
      'https://github.com/Example/example-server/pull/1',
    );
    rerender(<AddTaskDialog open={false} onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />);
    rerender(<AddTaskDialog open onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />);
    expect(screen.getByLabelText(/issue or pull request url/i)).toHaveValue('');
  });
});
