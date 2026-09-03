import type { TaskKind } from '../types';

export type ParsedTask = { kind: TaskKind; owner: string; repo: string; number: number };

export type ParseTaskResult = { ok: true; value: ParsedTask } | { ok: false; error: string };

function fail(error: string): ParseTaskResult {
  return { ok: false, error };
}

function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return value > 0 ? value : null;
}

/**
 * Accepts a full GitHub issue or pull request URL. No `owner/repo#number`
 * shorthand: issues and PRs share one number sequence per repo, so the
 * shorthand can't say which type it names without an extra request to
 * GitHub — see spec §7. `parsePrUrl` (used by the Pull Requests and
 * Backports tabs, where every target is necessarily a PR) is unaffected.
 */
export function parseTaskUrl(input: string): ParseTaskResult {
  const trimmed = input.trim();
  if (trimmed === '') return fail('Enter an issue or pull request URL — the input is empty.');

  if (/^[^/\s]+\/[^/\s]+#\d+$/.test(trimmed)) {
    return fail(
      'Tasks needs the full GitHub link — owner/repo#N could be either an issue or a pull request.',
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return fail('That is not a GitHub issue or pull request URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return fail('Only http and https URLs are supported.');
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    return fail(`Only github.com URLs are supported, not ${url.hostname}.`);
  }

  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const [owner, repo, kind, rawNumber] = segments;

  if (owner === undefined || repo === undefined) {
    return fail('That URL does not point at an issue or a pull request.');
  }
  if (kind === undefined) {
    return fail('That URL points at a repository, not an issue or a pull request.');
  }
  if (kind !== 'pull' && kind !== 'issues') {
    return fail(`That URL points at "${kind}", not an issue or a pull request.`);
  }

  const number = parseNumber(rawNumber);
  if (number === null) {
    return fail('That number is missing or not a positive whole number.');
  }

  return { ok: true, value: { kind: kind === 'pull' ? 'pr' : 'issue', owner, repo, number } };
}
