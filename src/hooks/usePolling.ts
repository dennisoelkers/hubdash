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
  const pending = useRef(false);
  const pollRef = useRef(poll);
  const runRef = useRef<() => void>(() => {});

  // Kept in an effect declared before the interval effect, so the interval
  // always sees the current callback without being torn down on every render.
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  const run = useCallback(() => {
    if (inFlight.current) {
      // Blocked, not dropped. A caller that asked for a poll had a reason —
      // App asks because the tracked list changed, and the board renders only
      // from the last poll's entries, so discarding the request leaves the PR
      // the user just added invisible for up to a full interval. One flag for
      // any number of blocked calls: they all want the same single refresh.
      pending.current = true;
      return;
    }
    inFlight.current = true;
    setIsPolling(true);

    const release = () => {
      inFlight.current = false;
      setIsPolling(false);
      if (!pending.current) return;
      pending.current = false;
      // Via a ref rather than `run` itself: a `useCallback` cannot name itself
      // in its own dependency list without either lying about its deps or
      // being re-created on every render, which would tear down the interval.
      runRef.current();
    };
    // Both arms release the guard. `.then(release, release)` rather than
    // `.finally(release)` is deliberate: `.finally` re-throws, so a `poll`
    // that rejects would escape as an unhandled promise rejection. The poll
    // callback owns its own error reporting; this hook's only job is making
    // sure a failed poll cannot wedge the guard shut forever.
    pollRef.current().then(release, release);
  }, []);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

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
      // A queued follow-up belongs to the loop being torn down. Dropping it
      // here is what keeps a poll in flight at unmount from starting another
      // request against a component that no longer exists.
      pending.current = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, intervalMs, run]);

  return { refresh: run, isPolling };
}
