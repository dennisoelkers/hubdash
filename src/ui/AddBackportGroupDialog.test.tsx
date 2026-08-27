import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddBackportGroupDialog } from './AddBackportGroupDialog';

const URL = 'https://github.com/Graylog2/graylog2-server/pull/4821';

function setup(onAdd = vi.fn().mockReturnValue({ added: true, key: 'k' })) {
  const onClose = vi.fn();
  render(<AddBackportGroupDialog open onClose={onClose} onAdd={onAdd} />);
  return { onAdd, onClose };
}

describe('AddBackportGroupDialog', () => {
  it('renders nothing when closed', () => {
    render(<AddBackportGroupDialog open={false} onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('creates a group from a valid URL and a version list', async () => {
    const { onAdd, onClose } = setup();
    await userEvent.type(screen.getByLabelText(/main pull request/i), URL);
    await userEvent.type(screen.getByLabelText(/backport to/i), '6.2, 6.1');
    await userEvent.click(screen.getByRole('button', { name: /track/i }));

    expect(onAdd).toHaveBeenCalledWith(
      { owner: 'Graylog2', repo: 'graylog2-server', number: 4821 },
      ['6.2', '6.1'],
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('accepts an empty version list', async () => {
    const { onAdd } = setup();
    await userEvent.type(screen.getByLabelText(/main pull request/i), URL);
    await userEvent.click(screen.getByRole('button', { name: /track/i }));
    expect(onAdd).toHaveBeenCalledWith(
      { owner: 'Graylog2', repo: 'graylog2-server', number: 4821 },
      [],
    );
  });

  it('shows the parser error and does not add, for an invalid main PR URL', async () => {
    const { onAdd, onClose } = setup();
    await userEvent.type(screen.getByLabelText(/main pull request/i), 'https://gitlab.com/a/b/pull/1');
    await userEvent.click(screen.getByRole('button', { name: /track/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/github\.com/i);
    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('tells nothing extra and still closes when the main PR is already tracked', async () => {
    const onAdd = vi.fn().mockReturnValue({ added: false, key: 'k' });
    const { onClose } = setup(onAdd);
    await userEvent.type(screen.getByLabelText(/main pull request/i), URL);
    await userEvent.click(screen.getByRole('button', { name: /track/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape and on Cancel', async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('resets both fields when reopened', async () => {
    const { rerender } = render(
      <AddBackportGroupDialog open onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />,
    );
    await userEvent.type(screen.getByLabelText(/main pull request/i), URL);
    rerender(<AddBackportGroupDialog open={false} onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />);
    rerender(<AddBackportGroupDialog open onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />);
    expect(screen.getByLabelText(/main pull request/i)).toHaveValue('');
  });
});
