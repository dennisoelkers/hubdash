import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePolling } from './usePolling';

let hidden = false;

function setHidden(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  hidden = false;
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Lets a pending poll's guard-release microtask run, inside `act` so the
 * resulting state update is not reported as an unmanaged update.
 *
 * This is load-bearing with fake timers, not ceremony: `advanceTimersByTime`
 * fires the interval callback synchronously, so without flushing first the
 * PREVIOUS poll's in-flight guard is still held and the tick is correctly
 * skipped. Omitting it makes an interval test look broken, and — worse — makes
 * every "did not poll" assertion pass for the wrong reason.
 */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('usePolling', () => {
  it('polls immediately on mount when enabled', async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePolling({ enabled: true, intervalMs: 15000, poll }));
    expect(poll).toHaveBeenCalledTimes(1);
    await settle();
  });

  it('does not poll at all when disabled', () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePolling({ enabled: false, intervalMs: 15000, poll }));
    act(() => void vi.advanceTimersByTime(60000));
    expect(poll).not.toHaveBeenCalled();
  });

  it('polls again on each interval tick', async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePolling({ enabled: true, intervalMs: 15000, poll }));
    expect(poll).toHaveBeenCalledTimes(1);

    await settle();
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(poll).toHaveBeenCalledTimes(2);

    await settle();
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('does not poll on mount while the document is hidden', () => {
    hidden = true;
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePolling({ enabled: true, intervalMs: 15000, poll }));
    expect(poll).not.toHaveBeenCalled();
  });

  it('stops ticking when the document becomes hidden', async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePolling({ enabled: true, intervalMs: 15000, poll }));
    // Without this the mount poll's guard is still held, and the assertion
    // below would pass because of the guard rather than because hiding worked.
    await settle();
    poll.mockClear();

    await act(async () => {
      setHidden(true);
      vi.advanceTimersByTime(60000);
    });
    expect(poll).not.toHaveBeenCalled();
  });

  it('polls immediately when the document becomes visible again', async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePolling({ enabled: true, intervalMs: 15000, poll }));
    await settle();

    await act(async () => {
      setHidden(true);
    });
    poll.mockClear();

    await act(async () => {
      setHidden(false);
    });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('does not start a second poll while one is in flight', async () => {
    const releases: Array<() => void> = [];
    const poll = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );
    const { result } = renderHook(() => usePolling({ enabled: true, intervalMs: 15000, poll }));
    expect(poll).toHaveBeenCalledTimes(1);

    // A manual refresh and an interval tick, both while the first is pending.
    act(() => result.current.refresh());
    act(() => void vi.advanceTimersByTime(15000));
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      releases[0]?.();
    });
    // One follow-up for the two blocked calls, and it starts only once the
    // first has finished — never two at the same time.
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('runs a poll blocked by the guard once the in-flight one finishes', async () => {
    const releases: Array<() => void> = [];
    const poll = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );
    const { result } = renderHook(() => usePolling({ enabled: true, intervalMs: 15000, poll }));
    expect(poll).toHaveBeenCalledTimes(1);

    // This is the shape of App's "the tracked list changed" refresh: dropping it
    // leaves a just-added PR invisible until the next tick, because the board
    // renders only from the last poll's entries.
    act(() => result.current.refresh());
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      releases[0]?.();
    });
    expect(poll).toHaveBeenCalledTimes(2);

    // The follow-up is drained, not sticky: finishing it starts nothing more.
    await act(async () => {
      releases[1]?.();
    });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('coalesces any number of blocked calls into exactly one follow-up', async () => {
    const releases: Array<() => void> = [];
    const poll = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );
    const { result } = renderHook(() => usePolling({ enabled: true, intervalMs: 15000, poll }));

    act(() => result.current.refresh());
    act(() => result.current.refresh());
    act(() => result.current.refresh());
    act(() => void vi.advanceTimersByTime(15000));
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      releases[0]?.();
    });
    expect(poll).toHaveBeenCalledTimes(2);

    await act(async () => {
      releases[1]?.();
    });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('never has two polls running at the same time', async () => {
    let concurrent = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const poll = vi.fn().mockImplementation(() => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      return new Promise<void>((resolve) => {
        releases.push(() => {
          concurrent -= 1;
          resolve();
        });
      });
    });
    const { result } = renderHook(() => usePolling({ enabled: true, intervalMs: 15000, poll }));

    for (let index = 0; index < 5; index += 1) {
      act(() => result.current.refresh());
      act(() => void vi.advanceTimersByTime(15000));
    }
    // Drain everything the hook queued, releasing each poll in turn.
    for (let index = 0; index < 5; index += 1) {
      await act(async () => {
        releases[index]?.();
      });
    }

    expect(peak).toBe(1);
  });

  it('reports whether a poll is in flight', async () => {
    let release: (() => void) | undefined;
    const poll = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => usePolling({ enabled: true, intervalMs: 15000, poll }));
    expect(result.current.isPolling).toBe(true);

    await act(async () => {
      release?.();
    });
    expect(result.current.isPolling).toBe(false);
  });

  it('releases the in-flight guard even when the poll rejects', async () => {
    const poll = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePolling({ enabled: true, intervalMs: 15000, poll }));

    await settle();
    act(() => result.current.refresh());
    expect(poll).toHaveBeenCalledTimes(2);
    await settle();
  });

  it('stops polling after unmount', async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => usePolling({ enabled: true, intervalMs: 15000, poll }));
    await settle();
    unmount();
    poll.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    expect(poll).not.toHaveBeenCalled();
  });
});
