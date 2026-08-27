import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { formatAgo } from '../domain/formatAgo';
import { prKey } from '../domain/prKey';
import { groupIntoColumns } from '../domain/sort';
import { fetchBoard } from '../github/client';
import { parsePrUrl } from '../github/parseUrl';
import { useDragAndPaste } from '../hooks/useDragAndPaste';
import { usePolling } from '../hooks/usePolling';
import { useTrackedPrs } from '../hooks/useTrackedPrs';
import { clearToken, loadToken, saveToken } from '../storage/token';
import type { ColumnId, PrEntry, PrKey, RateLimit, TransportError } from '../types';
import { AddPrDialog } from './AddPrDialog';
import { Banner } from './Banner';
import { Board } from './Board';
import { DropOverlay } from './DropOverlay';
import { GlobalStyle } from './GlobalStyle';
import type { TokenValidator } from './SettingsDialog';
import { SettingsDialog } from './SettingsDialog';
import { TopBar } from './TopBar';
import { tokens } from './theme';

export const POLL_INTERVAL_MS = 15000;
const FLASH_MS = 1500;

/**
 * How long polling backs off after a rate-limit failure that carried no reset
 * time. GitHub usually supplies one, but not always — and an unbounded wait for
 * a time that will never arrive means `canPoll` stays false forever and the
 * board is dead until reload. Four poll intervals is long enough to stop
 * hammering an exhausted budget and short enough to recover unattended.
 */
export const RATE_LIMIT_FALLBACK_MS = 60000;

export type AppDeps = {
  fetchImpl?: typeof fetch;
  storage?: Storage | null;
  clock?: () => string;
  nowMs?: () => number;
  /** Injected by tests so the first-run path can be exercised without a network. */
  validate?: TokenValidator;
};

/**
 * Whether a rate-limit error should still be suppressing polls. A known
 * `resetAt` is authoritative; without one the only bound available is how long
 * ago the error arrived, which is why `errorAt` is recorded alongside it.
 */
function isRateLimitActive(
  error: TransportError | null,
  errorAt: number | null,
  now: number,
): boolean {
  if (error?.kind !== 'rateLimited') return false;
  const resetMs = error.resetAt === null ? Number.NaN : Date.parse(error.resetAt);
  if (Number.isNaN(resetMs)) {
    return errorAt !== null && now - errorAt < RATE_LIMIT_FALLBACK_MS;
  }
  return resetMs > now;
}

/** Spec §9: the rate-limit banner has to name the reset time, not just the failure. */
function bannerText(error: TransportError): string {
  if (error.kind === 'auth') return `${error.message} Open settings to enter it again.`;
  if (error.kind !== 'rateLimited') return error.message;
  const resetMs = error.resetAt === null ? Number.NaN : Date.parse(error.resetAt);
  return Number.isNaN(resetMs)
    ? `${error.message} Polling resumes shortly.`
    : `${error.message} Polling resumes at ${new Date(resetMs).toLocaleTimeString()}.`;
}

const Empty = styled.div`
  padding: ${tokens.space(12)} ${tokens.space(5)};
  text-align: center;
  color: ${tokens.color.textMuted};
  font-family: ${tokens.font.body};
`;

const EMPTY_COLUMNS: Record<ColumnId, PrEntry[]> = {
  waiting: [],
  needsAction: [],
  ready: [],
  archive: [],
};

export function App({ deps = {} }: { deps?: AppDeps } = {}) {
  const { fetchImpl, storage, clock, nowMs = () => Date.now(), validate } = deps;

  const { prs, add, remove, storageError, dismissStorageError } = useTrackedPrs({ storage, clock });

  // Both halves of the load are used: an unreadable token is treated as absent
  // *and reported*, the same contract the tracked list already honours.
  const [storedToken] = useState(() => loadToken(storage));
  const [token, setToken] = useState<string | null>(storedToken.token);
  const [tokenError, setTokenError] = useState<string | null>(storedToken.error);
  const [entries, setEntries] = useState<PrEntry[]>([]);
  const [rateLimit, setRateLimit] = useState<RateLimit | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [transportError, setTransportError] = useState<TransportError | null>(null);
  const [errorAt, setErrorAt] = useState<number | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [flashedKey, setFlashedKey] = useState<PrKey | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tick, setTick] = useState(() => nowMs());

  // Kept together so the timestamp can never drift from the error it dates.
  const reportTransportError = useCallback(
    (error: TransportError | null) => {
      setTransportError(error);
      setErrorAt(error === null ? null : nowMs());
    },
    [nowMs],
  );

  // A rejected token will be rejected again; a hard rate limit needs the reset
  // to pass. Both stop the loop rather than hammering GitHub. `poll` checks
  // this itself rather than leaning on usePolling's `enabled`, because the
  // manual Refresh button calls `poll` directly and must be gated too.
  const rateLimited = isRateLimitActive(transportError, errorAt, tick);
  const canPoll =
    token !== null && prs.length > 0 && transportError?.kind !== 'auth' && !rateLimited;

  const poll = useCallback(async () => {
    if (!canPoll || token === null) return;

    const outcome = await fetchBoard(token, prs, fetchImpl ? { fetchImpl } : {});
    if (!outcome.ok) {
      // Deliberately does not clear `entries`: the last good board stays up.
      reportTransportError(outcome.error);
      return;
    }
    reportTransportError(null);
    setEntries(outcome.result.entries);
    setRateLimit(outcome.result.rateLimit);
    setLastUpdatedAt(new Date(nowMs()).toISOString());
  }, [canPoll, token, prs, fetchImpl, nowMs, reportTransportError]);

  const { refresh, isPolling } = usePolling({
    enabled: canPoll,
    intervalMs: POLL_INTERVAL_MS,
    poll,
  });

  // Adding or removing a PR should not wait for the next tick.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (canPoll) refresh();
  }, [prs, canPoll, refresh]);

  // Drives the freshness label and the rate-limit backoff check.
  useEffect(() => {
    const timer = setInterval(() => setTick(nowMs()), 1000);
    return () => clearInterval(timer);
  }, [nowMs]);

  const flash = useCallback((key: PrKey) => {
    setFlashedKey(key);
    setTimeout(() => setFlashedKey((current) => (current === key ? null : current)), FLASH_MS);
  }, []);

  const addParsed = useCallback(
    (parsed: Parameters<typeof add>[0]) => {
      const outcome = add(parsed);
      if (!outcome.added) flash(outcome.key);
      return outcome;
    },
    [add, flash],
  );

  const addFromText = useCallback(
    (text: string) => {
      const parsed = parsePrUrl(text);
      if (!parsed.ok) {
        setInputError(parsed.error);
        return;
      }
      setInputError(null);
      addParsed(parsed.value);
    },
    [addParsed],
  );

  const { isDragging } = useDragAndPaste(addFromText);

  const handleRemove = useCallback(
    (key: PrKey) => {
      remove(key);
      setEntries((current) => current.filter((entry) => entry.key !== key));
    },
    [remove],
  );

  // The tracked list is the source of truth for what is on the board; the last
  // poll only supplies status. Anything untracked is dropped.
  const columns = useMemo(() => {
    if (prs.length === 0) return EMPTY_COLUMNS;
    const tracked = new Set(prs.map((pr) => prKey(pr.owner, pr.repo, pr.number)));
    return groupIntoColumns(entries.filter((entry) => tracked.has(entry.key)));
  }, [entries, prs]);

  const freshness = useMemo(
    () =>
      lastUpdatedAt === null
        ? null
        : {
            label: formatAgo(lastUpdatedAt, tick),
            stale: tick - Date.parse(lastUpdatedAt) > POLL_INTERVAL_MS * 2,
          },
    [lastUpdatedAt, tick],
  );

  const showBoard = token !== null && prs.length > 0;

  return (
    <>
      <GlobalStyle />
      <TopBar
        onAdd={() => setAddOpen(true)}
        onRefresh={refresh}
        isPolling={isPolling}
        freshness={freshness}
        rateLimit={rateLimit}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {storageError === null ? null : (
        <Banner tone="warn" onDismiss={dismissStorageError}>
          {storageError}
        </Banner>
      )}
      {tokenError === null ? null : (
        <Banner tone="warn" onDismiss={() => setTokenError(null)}>
          {tokenError}
        </Banner>
      )}
      {transportError === null ? null : (
        <Banner
          tone={transportError.kind === 'network' ? 'warn' : 'bad'}
          onDismiss={
            transportError.kind === 'auth' ? undefined : () => reportTransportError(null)
          }
        >
          {bannerText(transportError)}
        </Banner>
      )}
      {inputError === null ? null : (
        <Banner tone="warn" onDismiss={() => setInputError(null)}>
          {inputError}
        </Banner>
      )}

      {token === null ? (
        <Empty>Add a GitHub token in settings to start tracking pull requests.</Empty>
      ) : null}
      {token !== null && prs.length === 0 ? (
        <Empty>Add a pull request — use the button, paste a URL, or drop a link here.</Empty>
      ) : null}
      {showBoard ? (
        <Board columns={columns} onRemove={handleRemove} flashedKey={flashedKey} />
      ) : null}

      <AddPrDialog open={addOpen} onClose={() => setAddOpen(false)} onAdd={addParsed} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        hasToken={token !== null}
        validate={validate}
        onSave={(next) => {
          saveToken(next, storage);
          setToken(next);
          setTokenError(null);
          reportTransportError(null);
        }}
        onClear={() => {
          clearToken(storage);
          setToken(null);
        }}
      />
      <DropOverlay visible={isDragging} />
    </>
  );
}
