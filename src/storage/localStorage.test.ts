import { describe, expect, it, vi } from 'vitest';
import { defaultStorage, readKey, removeKey, resolveStorage, writeKey } from './localStorage';

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

/** A Storage whose every accessor throws, as a blocked browser's does. */
function hostileStorage(): Storage {
  const boom = () => {
    throw new Error('SecurityError');
  };
  return {
    get length(): number {
      return boom();
    },
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  };
}

describe('resolveStorage', () => {
  it('is three-state: undefined uses the default, a Storage is used, null means none', () => {
    const storage = fakeStorage();
    expect(resolveStorage(storage)).toBe(storage);
    // Explicit null must NOT fall back to the real localStorage.
    expect(resolveStorage(null)).toBeNull();
    expect(resolveStorage(undefined)).toBe(defaultStorage());
  });
});

describe('readKey', () => {
  it('reads a value', () => {
    expect(readKey(fakeStorage({ a: '1' }), 'a')).toBe('1');
  });

  it('returns null for an absent key', () => {
    expect(readKey(fakeStorage(), 'a')).toBeNull();
  });

  it('returns null when no storage is available', () => {
    expect(readKey(null, 'a')).toBeNull();
  });

  it('returns null rather than throwing when storage access throws', () => {
    expect(readKey(hostileStorage(), 'a')).toBeNull();
  });
});

describe('writeKey', () => {
  it('writes a value', () => {
    const storage = fakeStorage();
    writeKey(storage, 'a', '1');
    expect(storage.getItem('a')).toBe('1');
  });

  it('does nothing when no storage is available', () => {
    expect(() => writeKey(null, 'a', '1')).not.toThrow();
  });

  it('swallows a write failure rather than throwing into a render', () => {
    // Quota exhausted or storage blocked. Losing persistence is survivable;
    // throwing during render is not.
    expect(() => writeKey(hostileStorage(), 'a', '1')).not.toThrow();
  });
});

describe('removeKey', () => {
  it('removes a value', () => {
    const storage = fakeStorage({ a: '1' });
    removeKey(storage, 'a');
    expect(storage.getItem('a')).toBeNull();
  });

  it('swallows a failure', () => {
    expect(() => removeKey(hostileStorage(), 'a')).not.toThrow();
    expect(() => removeKey(null, 'a')).not.toThrow();
  });
});

describe('defaultStorage', () => {
  it('returns null rather than throwing when window.localStorage throws', () => {
    const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(defaultStorage()).toBeNull();
    spy.mockRestore();
  });
});
