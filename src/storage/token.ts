import { readKey, removeKey, writeKey } from './localStorage';

export const TOKEN_KEY = 'hubdash.token';

const VERSION = 1;

export type LoadTokenResult = { token: string | null; error: string | null };

export function loadToken(storage?: Storage | null): LoadTokenResult {
  const raw = readKey(storage, TOKEN_KEY);
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
  writeKey(storage, TOKEN_KEY, JSON.stringify({ version: VERSION, token }));
}

export function clearToken(storage?: Storage | null): void {
  removeKey(storage, TOKEN_KEY);
}
