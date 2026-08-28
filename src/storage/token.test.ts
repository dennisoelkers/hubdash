import { describe, expect, it } from 'vitest';
import { TOKEN_KEY, clearToken, loadToken, saveToken } from './token';

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

describe('token storage', () => {
  it('returns null with no error when absent', () => {
    expect(loadToken(fakeStorage())).toEqual({ token: null, error: null });
  });

  it('round-trips a token', () => {
    const storage = fakeStorage();
    saveToken('ghp_example', storage);
    expect(loadToken(storage)).toEqual({ token: 'ghp_example', error: null });
  });

  it('writes a versioned envelope', () => {
    const storage = fakeStorage();
    saveToken('ghp_example', storage);
    expect(JSON.parse(storage.getItem(TOKEN_KEY) ?? '')).toEqual({
      version: 1,
      token: 'ghp_example',
    });
  });

  it('reports an error and returns null for an unusable value', () => {
    for (const raw of [
      'not json{',
      '{}',
      '{"version":1}',
      '{"version":9,"token":"x"}',
      '{"version":1,"token":42}',
    ]) {
      const result = loadToken(fakeStorage({ [TOKEN_KEY]: raw }));
      expect(result.token, raw).toBeNull();
      expect(result.error, raw).toBeTruthy();
    }
  });

  it('treats an empty token as absent rather than valid', () => {
    const raw = JSON.stringify({ version: 1, token: '' });
    expect(loadToken(fakeStorage({ [TOKEN_KEY]: raw })).token).toBeNull();
  });

  it('does NOT preserve a corrupt token anywhere', () => {
    // Unlike the PR list, a bad token is worth nothing and must not be copied
    // into a second key where it would linger.
    const storage = fakeStorage({ [TOKEN_KEY]: 'not json{' });
    loadToken(storage);
    expect(storage.length).toBe(1);
  });

  it('clears the token', () => {
    const storage = fakeStorage();
    saveToken('ghp_example', storage);
    clearToken(storage);
    expect(loadToken(storage).token).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    expect(loadToken(null)).toEqual({ token: null, error: null });
    expect(() => saveToken('x', null)).not.toThrow();
    expect(() => clearToken(null)).not.toThrow();
  });
});
