import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddPrDialog } from './AddPrDialog';

const URL = 'https://github.com/Example/example-server/pull/4821';

function setup(onAdd = vi.fn().mockReturnValue({ added: true, key: 'k' })) {
  const onClose = vi.fn();
  render(<AddPrDialog open onClose={onClose} onAdd={onAdd} />);
  return { onAdd, onClose };
}

describe('AddPrDialog', () => {
  it('renders nothing when closed', () => {
    render(<AddPrDialog open={false} onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('adds a valid URL and closes', async () => {
    const { onAdd, onClose } = setup();
    await userEvent.type(screen.getByLabelText(/pull request url/i), URL);
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(onAdd).toHaveBeenCalledWith({ owner: 'Example', repo: 'example-server', number: 4821 });
    expect(onClose).toHaveBeenCalled();
  });

  it('submits on Enter as well as on the button', async () => {
    const { onAdd } = setup();
    await userEvent.type(screen.getByLabelText(/pull request url/i), `${URL}{Enter}`);
    expect(onAdd).toHaveBeenCalled();
  });

  it('shows the parser error and does not add, for an invalid URL', async () => {
    const { onAdd, onClose } = setup();
    await userEvent.type(screen.getByLabelText(/pull request url/i), 'https://gitlab.com/a/b/pull/1');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/github\.com/i);
    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('accepts the owner/repo#number shorthand', async () => {
    const { onAdd } = setup();
    await userEvent.type(screen.getByLabelText(/pull request url/i), 'Example/example-server#4821');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(onAdd).toHaveBeenCalledWith({ owner: 'Example', repo: 'example-server', number: 4821 });
  });

  it('tells the user when the PR is already on the board, and still closes', async () => {
    const onAdd = vi.fn().mockReturnValue({ added: false, key: 'k' });
    const { onClose } = setup(onAdd);
    await userEvent.type(screen.getByLabelText(/pull request url/i), URL);
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it('clears a previous error when the input changes', async () => {
    setup();
    const input = screen.getByLabelText(/pull request url/i);
    await userEvent.type(input, 'rubbish');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, 'h');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes on Escape and on Cancel', async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
