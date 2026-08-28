import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from './SettingsDialog';

function setup(overrides: Partial<Parameters<typeof SettingsDialog>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    hasToken: false,
    onSave: vi.fn(),
    onClear: vi.fn(),
    validate: vi.fn().mockResolvedValue({ ok: true, login: 'octocat' }),
    ...overrides,
  };
  render(<SettingsDialog {...props} />);
  return props;
}

describe('SettingsDialog', () => {
  it('renders nothing when closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('masks the token input', () => {
    setup();
    expect(screen.getByLabelText(/personal access token/i)).toHaveAttribute('type', 'password');
  });

  it('validates then saves, reporting the resolved login', async () => {
    const props = setup();
    await userEvent.type(screen.getByLabelText(/personal access token/i), 'ghp_example');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(props.validate).toHaveBeenCalledWith('ghp_example'));
    expect(props.onSave).toHaveBeenCalledWith('ghp_example');
    expect(await screen.findByText(/octocat/)).toBeInTheDocument();
  });

  it('does not save a token GitHub rejects', async () => {
    const props = setup({
      validate: vi.fn().mockResolvedValue({ ok: false, error: 'GitHub rejected the token.' }),
    });
    await userEvent.type(screen.getByLabelText(/personal access token/i), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/rejected/i);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('refuses to validate an empty token', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(props.validate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('offers a clear control only when a token is stored', async () => {
    const { onClear } = setup({ hasToken: true });
    await userEvent.click(screen.getByRole('button', { name: /clear token/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it('hides the clear control when no token is stored', () => {
    setup({ hasToken: false });
    expect(screen.queryByRole('button', { name: /clear token/i })).not.toBeInTheDocument();
  });

  it('never renders the token value in the document text', async () => {
    setup({ hasToken: true });
    await userEvent.type(screen.getByLabelText(/personal access token/i), 'ghp_secretvalue');
    expect(document.body.textContent).not.toContain('ghp_secretvalue');
  });

  it('closes on Escape', async () => {
    const { onClose } = setup();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes itself after a successful save', async () => {
    const props = setup();
    await userEvent.type(screen.getByLabelText(/personal access token/i), 'ghp_example');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith('ghp_example'));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('does not close itself when the token is rejected', async () => {
    const props = setup({
      validate: vi.fn().mockResolvedValue({ ok: false, error: 'GitHub rejected the token.' }),
    });
    await userEvent.type(screen.getByLabelText(/personal access token/i), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/rejected/i);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('does not save when the dialog is dismissed while validation is in flight', async () => {
    // Regression: `submit` is an async closure and keeps running after the
    // dialog closes. Without a cancellation guard it called onSave anyway, so a
    // user who backed out of the dialog still had their token persisted.
    let release: ((outcome: { ok: true; login: string }) => void) | undefined;
    const validate = vi.fn().mockImplementation(
      () =>
        new Promise<{ ok: true; login: string }>((resolve) => {
          release = resolve;
        }),
    );
    const onSave = vi.fn();
    const props = {
      onClose: vi.fn(),
      hasToken: false,
      onSave,
      onClear: vi.fn(),
      validate,
    };
    const { rerender } = render(<SettingsDialog open {...props} />);

    await userEvent.type(screen.getByLabelText(/personal access token/i), 'ghp_example');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(validate).toHaveBeenCalledTimes(1);

    // The user dismisses the dialog before GitHub answers.
    rerender(<SettingsDialog open={false} {...props} />);

    await act(async () => {
      release?.({ ok: true, login: 'octocat' });
    });

    expect(onSave).not.toHaveBeenCalled();
  });
});
