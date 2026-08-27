import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { groupPrs } from '../domain/backports';
import { formatAgo } from '../domain/formatAgo';
import { prKey } from '../domain/prKey';
import { groupIntoColumns } from '../domain/sort';
import { fetchBoard } from '../github/client';
import { parsePrUrl } from '../github/parseUrl';
import { useBackportGroups } from '../hooks/useBackportGroups';
import { useDragAndPaste } from '../hooks/useDragAndPaste';
import { usePolling } from '../hooks/usePolling';
import { useTrackedPrs } from '../hooks/useTrackedPrs';
import { clearToken, loadToken, saveToken } from '../storage/token';
import type { ColumnId, PrEntry, PrKey, RateLimit, TrackedPr, TransportError } from '../types';
import { AddBackportGroupDialog } from './AddBackportGroupDialog';
import { AddPrDialog } from './AddPrDialog';
import { BackportsTab } from './BackportsTab';
import { Banner } from './Banner';
import { BoardTab } from './BoardTab';
import { DropOverlay } from './DropOverlay';
import { Empty } from './Empty';
import { GlobalStyle } from './GlobalStyle';
import type { TokenValidator } from './SettingsDialog';
import { SettingsDialog } from './SettingsDialog';
import type { TabId } from './TabBar';
import { TabBar } from './TabBar';
import { TopBar } from './TopBar';

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

/**
 * Module-level so its identity is stable, for the same reason useTrackedPrs
 * hoists its default clock: inlined as a default parameter this would be a new
 * function on every render, and App re-renders once a second to drive the
 * freshness label. Everything downstream of `nowMs` — `poll`, the error
 * reporter, the tick interval — would churn continuously, and the tick interval
 * in particular would be torn down and restarted on every render.
 */
const defaultNowMs = () => Date.now();

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

const EMPTY_COLUMNS: Record<ColumnId, PrEntry[]> = {
  waiting: [],
  needsAction: [],
  ready: [],
  archive: [],
};

export function App({ deps = {} }: { deps?: AppDeps } = {}) {
  const { fetchImpl, storage, clock, nowMs = defaultNowMs, validate } = deps;

  const { prs, add, remove, storageError, dismissStorageError } = useTrackedPrs({ storage, clock });
  const {
    groups,
    addGroup,
    removeGroup,
    addVersion,
    removeVersion,
    fillSlot,
    storageError: backportStorageError,
    dismissStorageError: dismissBackportStorageError,
  } = useBackportGroups({ storage, clock });

  // Both tabs are fed by one poll. Twenty PRs spread across board and backports
  // still cost one GraphQL request, because the query batches by alias — see
  // spec §9. Declared here, above `canPoll`, deliberately: `canPoll` and `poll`
  // are defined further down but still *before* the other memos, so grouping
  // this with `columns` would read `pollTargets` from its temporal dead zone —
  // a render-time ReferenceError that tsc cannot see.
  const pollTargets = useMemo(() => {
    const byKey = new Map<PrKey, TrackedPr>();
    for (const pr of prs) byKey.set(prKey(pr.owner, pr.repo, pr.number), pr);
    // First writer wins, deliberately: when the same PR is on the board *and* in
    // a group, the board's entry is the one that survives, because the board
    // owns the tracked list — its `addedAt`, and the owner/repo casing an
    // errored entry renders, come from there rather than from whichever loop
    // happened to run last.
    for (const group of groups) {
      for (const pr of groupPrs(group)) {
        const key = prKey(pr.owner, pr.repo, pr.number);
        if (!byKey.has(key)) byKey.set(key, pr);
      }
    }
    return [...byKey.values()];
  }, [prs, groups]);

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
  // Opens on launch whenever there's no token to poll with — including one
  // that was stored but unreadable, since `storedToken.token` is already null
  // in that case too.
  const [settingsOpen, setSettingsOpen] = useState(() => storedToken.token === null);
  const [activeTab, setActiveTab] = useState<TabId>('board');
  const [backportDialogOpen, setBackportDialogOpen] = useState(false);
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
    token !== null && pollTargets.length > 0 && transportError?.kind !== 'auth' && !rateLimited;

  const poll = useCallback(async () => {
    if (!canPoll || token === null) return;

    const outcome = await fetchBoard(token, pollTargets, fetchImpl ? { fetchImpl } : {});
    if (!outcome.ok) {
      // Deliberately does not clear `entries`: the last good board stays up.
      reportTransportError(outcome.error);
      return;
    }
    reportTransportError(null);
    setEntries(outcome.result.entries);
    setRateLimit(outcome.result.rateLimit);
    setLastUpdatedAt(new Date(nowMs()).toISOString());
  }, [canPoll, token, pollTargets, fetchImpl, nowMs, reportTransportError]);

  const { refresh, isPolling } = usePolling({
    enabled: canPoll,
    intervalMs: POLL_INTERVAL_MS,
    poll,
  });

  // Adding or removing a PR — on either tab — should not wait for the next tick.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (canPoll) refresh();
  }, [pollTargets, canPoll, refresh]);

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

  // Spec §10.5: a duplicate main PR flashes the existing card. Dropping the
  // outcome on the floor here left the user's whole submission — versions
  // included — discarded in silence.
  const addGroupOrFlash = useCallback(
    (main: Parameters<typeof addGroup>[0], versions: string[]) => {
      const outcome = addGroup(main, versions);
      if (!outcome.added) flash(outcome.key);
      return outcome;
    },
    [addGroup, flash],
  );

  const addFromText = useCallback(
    (text: string) => {
      // Spec §10.4: on the Backports tab a dropped link has to land in a
      // specific slot, so the window-wide "add to the board" path stands down.
      // The listeners stay registered — only the behaviour is gated.
      if (activeTab !== 'board') return;
      const parsed = parsePrUrl(text);
      if (!parsed.ok) {
        setInputError(parsed.error);
        return;
      }
      setInputError(null);
      addParsed(parsed.value);
    },
    [activeTab, addParsed],
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

  const entryMap = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries]);

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

  return (
    <>
      <GlobalStyle />
      <TopBar
        onAdd={() => (activeTab === 'board' ? setAddOpen(true) : setBackportDialogOpen(true))}
        addLabel={activeTab === 'board' ? '+ Add PR' : '+ Track backports'}
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
      {backportStorageError === null ? null : (
        <Banner tone="warn" onDismiss={dismissBackportStorageError}>
          {backportStorageError}
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
      ) : (
        <>
          <TabBar
            active={activeTab}
            onChange={setActiveTab}
            boardCount={prs.length}
            backportsCount={groups.length}
          />
          {activeTab === 'board' ? (
            <BoardTab
              columns={columns}
              isEmpty={prs.length === 0}
              flashedKey={flashedKey}
              onRemove={handleRemove}
            />
          ) : (
            // `hasToken` is hardcoded because this whole branch is already
            // inside `token === null ? ... :` — BackportsTab's own no-token
            // empty state exists for its component tests, not for this call.
            <BackportsTab
              groups={groups}
              entries={entryMap}
              hasToken
              flashedKey={flashedKey}
              onRemoveGroup={removeGroup}
              onAddVersion={addVersion}
              onRemoveVersion={removeVersion}
              onFillSlot={fillSlot}
            />
          )}
        </>
      )}

      <AddPrDialog open={addOpen} onClose={() => setAddOpen(false)} onAdd={addParsed} />
      <AddBackportGroupDialog
        open={backportDialogOpen}
        onClose={() => setBackportDialogOpen(false)}
        onAdd={addGroupOrFlash}
      />
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
      <DropOverlay visible={isDragging && activeTab === 'board'} />
    </>
  );
}
