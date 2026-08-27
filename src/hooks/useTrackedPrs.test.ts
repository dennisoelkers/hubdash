import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TRACKED_PRS_KEY } from '../storage/trackedPrs';
import { useTrackedPrs } from './useTrackedPrs';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const clock = () => '2026-08-27T12:00:00Z';

function setup(storage: Storage = fakeStorage()) {
  return renderHook(() => useTrackedPrs({ storage, clock }));
}

describe('useTrackedPrs', () => {
  it('starts empty when nothing is stored', () => {
    const { result } = setup();
    expect(result.current.prs).toEqual([]);
    expect(result.current.storageError).toBeNull();
  });

  it('loads what was stored', () => {
    const stored = JSON.stringify({
      version: 1,
      prs: [{ owner: 'Graylog2', repo: 'graylog2-server', number: 4821, addedAt: '2026-08-01T00:00:00Z' }],
    });
    const { result } = setup(fakeStorage({ [TRACKED_PRS_KEY]: stored }));
    expect(result.current.prs).toHaveLength(1);
  });

  it('adds a PR and stamps addedAt from the clock', () => {
    const { result } = setup();
    act(() => {
      result.current.add({ owner: 'Graylog2', repo: 'graylog2-server', number: 4821 });
    });
    expect(result.current.prs).toEqual([
      { owner: 'Graylog2', repo: 'graylog2-server', number: 4821, addedAt: '2026-08-27T12:00:00Z' },
    ]);
  });

  it('persists an added PR immediately', () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => useTrackedPrs({ storage, clock }));
    act(() => {
      result.current.add({ owner: 'Graylog2', repo: 'graylog2-server', number: 4821 });
    });
    expect(JSON.parse(storage.getItem(TRACKED_PRS_KEY) ?? '').prs).toHaveLength(1);
  });

  it('reports added:true with the key for a new PR', () => {
    const { result } = setup();
    let outcome: { added: boolean; key: string } | undefined;
    act(() => {
      outcome = result.current.add({ owner: 'Graylog2', repo: 'graylog2-server', number: 4821 });
    });
    expect(outcome).toEqual({ added: true, key: 'graylog2/graylog2-server#4821' });
  });

  it('reports added:false and does not duplicate an already-tracked PR', () => {
    const { result } = setup();
    act(() => {
      result.current.add({ owner: 'Graylog2', repo: 'graylog2-server', number: 4821 });
    });
    let outcome: { added: boolean; key: string } | undefined;
    act(() => {
      outcome = result.current.add({ owner: 'Graylog2', repo: 'graylog2-server', number: 4821 });
    });
    expect(outcome?.added).toBe(false);
    expect(result.current.prs).toHaveLength(1);
  });

  it('treats a casing difference as the same PR', () => {
    const { result } = setup();
    act(() => {
      result.current.add({ owner: 'Graylog2', repo: 'graylog2-server', number: 4821 });
    });
    let outcome: { added: boolean } | undefined;
    act(() => {
      outcome = result.current.add({ owner: 'GRAYLOG2', repo: 'Graylog2-Server', number: 4821 });
    });
    expect(outcome?.added).toBe(false);
    expect(result.current.prs).toHaveLength(1);
  });

  it('adds two PRs in sequence without losing the first', () => {
    const { result } = setup();
    act(() => {
      result.current.add({ owner: 'Graylog2', repo: 'graylog2-server', number: 1 });
      result.current.add({ owner: 'Graylog2', repo: 'graylog2-server', number: 2 });
    });
    expect(result.current.prs.map((pr) => pr.number)).toEqual([1, 2]);
  });

  it('removes a PR by key and persists the removal', () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => useTrackedPrs({ storage, clock }));
    act(() => {
      result.current.add({ owner: 'Graylog2', repo: 'graylog2-server', number: 4821 });
    });
    act(() => {
      result.current.remove('graylog2/graylog2-server#4821');
    });
    expect(result.current.prs).toEqual([]);
    expect(JSON.parse(storage.getItem(TRACKED_PRS_KEY) ?? '').prs).toEqual([]);
  });

  it('ignores a remove for an unknown key', () => {
    const { result } = setup();
    act(() => {
      result.current.add({ owner: 'Graylog2', repo: 'graylog2-server', number: 4821 });
    });
    act(() => {
      result.current.remove('nope/nope#1');
    });
    expect(result.current.prs).toHaveLength(1);
  });

  it('surfaces a storage load error and lets it be dismissed', () => {
    const { result } = setup(fakeStorage({ [TRACKED_PRS_KEY]: 'not json{' }));
    expect(result.current.storageError).toBeTruthy();
    act(() => {
      result.current.dismissStorageError();
    });
    expect(result.current.storageError).toBeNull();
  });

  it('does not overwrite an unreadable stored value until the user changes something', () => {
    // The corrupt value is preserved by loadTrackedPrs; this guards against the
    // hook itself eagerly saving an empty list over it on mount.
    const storage = fakeStorage({ [TRACKED_PRS_KEY]: 'not json{' });
    renderHook(() => useTrackedPrs({ storage, clock }));
    expect(storage.getItem(TRACKED_PRS_KEY)).toBe('not json{');
  });
});
