import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddBackportGroupDialog } from './AddBackportGroupDialog';

afterEach(() => {
  vi.useRealTimers();
});

const URL = 'https://github.com/Example/example-server/pull/4821';

function setup(onAdd = vi.fn().mockReturnValue({ added: true, key: 'k' })) {
  const onClose = vi.fn();
  render(<AddBackportGroupDialog open onClose={onClose} onAdd={onAdd} />);
  return { onAdd, onClose };
}

describe('AddBackportGroupDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <AddBackportGroupDialog
        open={false}
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('creates a group from a valid URL and a version list', async () => {
    const { onAdd, onClose } = setup();
    await userEvent.type(screen.getByLabelText(/main pull request/i), URL);
    await userEvent.type(screen.getByLabelText(/backport to/i), '6.2, 6.1');
    await userEvent.click(screen.getByRole('button', { name: /track/i }));

    expect(onAdd).toHaveBeenCalledWith({ owner: 'Example', repo: 'example-server', number: 4821 }, [
      '6.2',
      '6.1',
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('accepts an empty version list', async () => {
    const { onAdd } = setup();
    await userEvent.type(screen.getByLabelText(/main pull request/i), URL);
    await userEvent.click(screen.getByRole('button', { name: /track/i }));
    expect(onAdd).toHaveBeenCalledWith(
      { owner: 'Example', repo: 'example-server', number: 4821 },
      [],
    );
  });

  it('shows the parser error and does not add, for an invalid main PR URL', async () => {
    const { onAdd, onClose } = setup();
    await userEvent.type(
      screen.getByLabelText(/main pull request/i),
      'https://gitlab.com/a/b/pull/1',
    );
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
    rerender(
      <AddBackportGroupDialog
        open={false}
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
      />,
    );
    rerender(
      <AddBackportGroupDialog open onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />,
    );
    expect(screen.getByLabelText(/main pull request/i)).toHaveValue('');
  });
});

describe('AddBackportGroupDialog — pre-filled from a drop', () => {
  it('pre-fills the URL field from initialUrl when opened', () => {
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        initialUrl={URL}
      />,
    );
    expect(screen.getByLabelText(/main pull request/i)).toHaveValue(URL);
  });

  it('moves focus to the versions field when pre-filled', () => {
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        initialUrl={URL}
      />,
    );
    expect(screen.getByLabelText(/backport to/i)).toHaveFocus();
  });

  it('focuses the URL field instead when opened without initialUrl', () => {
    render(
      <AddBackportGroupDialog open onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />,
    );
    expect(screen.getByLabelText(/main pull request/i)).toHaveFocus();
  });

  it('leaves the URL field empty on a later open with no initialUrl', () => {
    const { rerender } = render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        initialUrl={URL}
      />,
    );
    expect(screen.getByLabelText(/main pull request/i)).toHaveValue(URL);
    rerender(
      <AddBackportGroupDialog
        open={false}
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
      />,
    );
    rerender(
      <AddBackportGroupDialog open onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />,
    );
    expect(screen.getByLabelText(/main pull request/i)).toHaveValue('');
  });
});

describe('AddBackportGroupDialog — version detection', () => {
  it('fills the versions field once detection resolves for a valid URL', async () => {
    vi.useFakeTimers();
    const detectVersions = vi.fn().mockResolvedValue(['7.1', '6.3', '7.0']);
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    fireEvent.change(screen.getByLabelText(/main pull request/i), { target: { value: URL } });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(detectVersions).toHaveBeenCalledTimes(1);
    expect(detectVersions).toHaveBeenCalledWith({
      owner: 'Example',
      repo: 'example-server',
      number: 4821,
    });
    expect(screen.getByLabelText(/backport to/i)).toHaveValue('7.1, 6.3, 7.0');
  });

  it('shows a Detecting placeholder while the lookup is in flight', async () => {
    vi.useFakeTimers();
    let resolve!: (versions: string[]) => void;
    const detectVersions = vi.fn().mockImplementation(
      () =>
        new Promise<string[]>((r) => {
          resolve = r;
        }),
    );
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    fireEvent.change(screen.getByLabelText(/main pull request/i), { target: { value: URL } });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByPlaceholderText(/detecting/i)).toBeInTheDocument();

    await act(async () => {
      resolve(['7.1']);
    });
    expect(screen.getByLabelText(/backport to/i)).toHaveValue('7.1');
  });

  it('does not fire again for the same PR when the field only re-settles on it', async () => {
    vi.useFakeTimers();
    const detectVersions = vi.fn().mockResolvedValue(['7.1']);
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    const input = screen.getByLabelText(/main pull request/i);
    fireEvent.change(input, { target: { value: URL } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(detectVersions).toHaveBeenCalledTimes(1);

    // Trailing whitespace still trims to the same PR identity.
    fireEvent.change(input, { target: { value: `${URL} ` } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(detectVersions).toHaveBeenCalledTimes(1);
  });

  it('never overwrites a versions field the user has already typed into', async () => {
    vi.useFakeTimers();
    let resolve!: (versions: string[]) => void;
    const detectVersions = vi.fn().mockImplementation(
      () =>
        new Promise<string[]>((r) => {
          resolve = r;
        }),
    );
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    fireEvent.change(screen.getByLabelText(/main pull request/i), { target: { value: URL } });
    fireEvent.change(screen.getByLabelText(/backport to/i), { target: { value: '9.9' } });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {
      resolve(['7.1', '6.3']);
    });
    expect(screen.getByLabelText(/backport to/i)).toHaveValue('9.9');
  });

  it('leaves the versions field untouched when detection finds nothing', async () => {
    vi.useFakeTimers();
    const detectVersions = vi.fn().mockResolvedValue([]);
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    fireEvent.change(screen.getByLabelText(/main pull request/i), { target: { value: URL } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(detectVersions).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/backport to/i)).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('leaves the versions field untouched when detection rejects', async () => {
    vi.useFakeTimers();
    const detectVersions = vi.fn().mockRejectedValue(new Error('network down'));
    render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    fireEvent.change(screen.getByLabelText(/main pull request/i), { target: { value: URL } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(detectVersions).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/backport to/i)).toHaveValue('');
  });

  it('does not attempt detection when no detectVersions prop is given', () => {
    render(
      <AddBackportGroupDialog open onClose={() => {}} onAdd={() => ({ added: true, key: 'k' })} />,
    );
    fireEvent.change(screen.getByLabelText(/main pull request/i), { target: { value: URL } });
    expect(screen.getByLabelText(/backport to/i)).toHaveValue('');
  });

  it('resets the touched flag and any in-flight detection state when reopened', async () => {
    vi.useFakeTimers();
    const detectVersions = vi.fn().mockResolvedValue(['7.1']);
    const { rerender } = render(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    fireEvent.change(screen.getByLabelText(/backport to/i), { target: { value: '9.9' } });
    rerender(
      <AddBackportGroupDialog
        open={false}
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    rerender(
      <AddBackportGroupDialog
        open
        onClose={() => {}}
        onAdd={() => ({ added: true, key: 'k' })}
        detectVersions={detectVersions}
      />,
    );
    fireEvent.change(screen.getByLabelText(/main pull request/i), { target: { value: URL } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByLabelText(/backport to/i)).toHaveValue('7.1');
  });
});
