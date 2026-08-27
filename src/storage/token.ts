import { defaultStorage } from './trackedPrs';

export const TOKEN_KEY = 'hubdash.token';

const VERSION = 1;

export type LoadTokenResult = { token: string | null; error: string | null };

function resolve(storage: Storage | null | undefined): Storage | null {
  return storage === undefined ? defaultStorage() : storage;
}

export function loadToken(storage?: Storage | null): LoadTokenResult {
  const target = resolve(storage);
  if (!target) return { token: null, error: null };

  let raw: string | null;
  try {
    raw = target.getItem(TOKEN_KEY);
  } catch {
    return { token: null, error: null };
  }
  if (raw === null) return { token: null, error: null };

  const invalid = { token: null, error: 'Your saved token could not be read. Enter it again.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return invalid;

  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== VERSION) return invalid;
  if (typeof envelope.token !== 'string') return invalid;
  if (envelope.token === '') return { token: null, error: null };

  return { token: envelope.token, error: null };
}

export function saveToken(token: string, storage?: Storage | null): void {
  const target = resolve(storage);
  if (!target) return;
  try {
    target.setItem(TOKEN_KEY, JSON.stringify({ version: VERSION, token }));
  } catch {
    // See saveTrackedPrs: failing to persist must not break the app.
  }
}

export function clearToken(storage?: Storage | null): void {
  const target = resolve(storage);
  if (!target) return;
  try {
    target.removeItem(TOKEN_KEY);
  } catch {
    // Nothing useful to do.
  }
}
