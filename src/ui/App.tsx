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
import { SettingsDialog } from './SettingsDialog';
import { TopBar } from './TopBar';
import { tokens } from './theme';

export const POLL_INTERVAL_MS = 15000;
const FLASH_MS = 1500;

export type AppDeps = {
  fetchImpl?: typeof fetch;
  storage?: Storage | null;
  clock?: () => string;
  nowMs?: () => number;
};

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
  const { fetchImpl, storage, clock, nowMs = () => Date.now() } = deps;

  const { prs, add, remove, storageError, dismissStorageError } = useTrackedPrs({ storage, clock });

  const [token, setToken] = useState<string | null>(() => loadToken(storage).token);
  const [entries, setEntries] = useState<PrEntry[]>([]);
  const [rateLimit, setRateLimit] = useState<RateLimit | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [transportError, setTransportError] = useState<TransportError | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [flashedKey, setFlashedKey] = useState<PrKey | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tick, setTick] = useState(() => nowMs());

  // A rejected token will be rejected again; a hard rate limit needs the reset
  // to pass. Both stop the loop rather than hammering GitHub. `poll` checks
  // this itself rather than leaning on usePolling's `enabled`, because the
  // manual Refresh button calls `poll` directly and must be gated too.
  const rateLimited =
    transportError?.kind === 'rateLimited' &&
    (transportError.resetAt === null || Date.parse(transportError.resetAt) > tick);
  const canPoll =
    token !== null && prs.length > 0 && transportError?.kind !== 'auth' && !rateLimited;

  const poll = useCallback(async () => {
    if (!canPoll || token === null) return;

    const outcome = await fetchBoard(token, prs, fetchImpl ? { fetchImpl } : {});
    if (!outcome.ok) {
      // Deliberately does not clear `entries`: the last good board stays up.
      setTransportError(outcome.error);
      return;
    }
    setTransportError(null);
    setEntries(outcome.result.entries);
    setRateLimit(outcome.result.rateLimit);
    setLastUpdatedAt(new Date(nowMs()).toISOString());
  }, [canPoll, token, prs, fetchImpl, nowMs]);

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
      {transportError === null ? null : (
        <Banner
          tone={transportError.kind === 'network' ? 'warn' : 'bad'}
          onDismiss={
            transportError.kind === 'auth' ? undefined : () => setTransportError(null)
          }
        >
          {transportError.kind === 'auth'
            ? `${transportError.message} Open settings to enter it again.`
            : transportError.message}
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
        onSave={(next) => {
          saveToken(next, storage);
          setToken(next);
          setTransportError(null);
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
