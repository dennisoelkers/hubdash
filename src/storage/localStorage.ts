/**
 * Throw-guarded `localStorage` access, shared by every store.
 *
 * `localStorage` can throw on *access*, not merely on write — Safari private
 * browsing and browsers configured to block site data both do — so every use
 * goes through here rather than touching `window.localStorage` directly. A
 * thrown quota or security error must never reach a React render.
 */
export function defaultStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Three-state by design, and the tests depend on it: `undefined` means "use the
 * real localStorage", an explicit `Storage` means "use this one", and explicit
 * `null` means "none is available". Note this is deliberately NOT
 * `storage ?? defaultStorage()`, which would turn an explicit null into the real
 * thing and quietly defeat every no-storage test.
 */
export function resolveStorage(storage: Storage | null | undefined): Storage | null {
  return storage === undefined ? defaultStorage() : storage;
}

export function readKey(storage: Storage | null | undefined, key: string): string | null {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    return target.getItem(key);
  } catch {
    return null;
  }
}

export function writeKey(storage: Storage | null | undefined, key: string, value: string): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.setItem(key, value);
  } catch {
    // Quota exhausted or storage blocked. Losing persistence is survivable;
    // throwing into a render is not.
  }
}

export function removeKey(storage: Storage | null | undefined, key: string): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.removeItem(key);
  } catch {
    // Nothing useful to do.
  }
}
