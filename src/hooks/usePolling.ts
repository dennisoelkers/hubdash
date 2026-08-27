import { useCallback, useEffect, useRef, useState } from 'react';

export type UsePollingArgs = {
  enabled: boolean;
  intervalMs: number;
  poll: () => Promise<void>;
};

export type UsePollingResult = {
  refresh: () => void;
  isPolling: boolean;
};

/**
 * Drives the board's refresh loop: an interval, a manual refresh, and a
 * visibility listener, all guarded so two polls never overlap. A tab left open
 * overnight neither burns rate-limit budget nor shows stale data on return.
 */
export function usePolling({ enabled, intervalMs, poll }: UsePollingArgs): UsePollingResult {
  const [isPolling, setIsPolling] = useState(false);
  const inFlight = useRef(false);
  const pollRef = useRef(poll);

  // Kept in an effect declared before the interval effect, so the interval
  // always sees the current callback without being torn down on every render.
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  const run = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsPolling(true);

    const release = () => {
      inFlight.current = false;
      setIsPolling(false);
    };
    // Both arms release the guard. `.then(release, release)` rather than
    // `.finally(release)` is deliberate: `.finally` re-throws, so a `poll`
    // that rejects would escape as an unhandled promise rejection. The poll
    // callback owns its own error reporting; this hook's only job is making
    // sure a failed poll cannot wedge the guard shut forever.
    pollRef.current().then(release, release);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer === null) timer = setInterval(run, intervalMs);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        run();
        start();
      }
    };

    if (!document.hidden) {
      run();
      start();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, intervalMs, run]);

  return { refresh: run, isPolling };
}
