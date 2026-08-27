export type ParsedPr = { owner: string; repo: string; number: number };

export type ParseResult =
  | { ok: true; value: ParsedPr }
  | { ok: false; error: string };

// Owner excludes ':' so a URL scheme cannot match it; repo excludes '/' so a
// path cannot. Without both, this matched entire URLs with a numeric fragment
// and returned garbage owner/repo values with ok: true.
const SHORTHAND = /^([^/\s:]+)\/([^/#\s]+)#(\d+)$/;

function fail(error: string): ParseResult {
  return { ok: false, error };
}

function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return value > 0 ? value : null;
}

/**
 * Accepts a GitHub PR URL (with any trailing segments, query, or fragment) or
 * the `owner/repo#number` shorthand. Casing is preserved; prKey folds it.
 */
export function parsePrUrl(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed === '') return fail('Enter a pull request URL — the input is empty.');

  const shorthand = SHORTHAND.exec(trimmed);
  if (shorthand) {
    const [, owner, repo, rawNumber] = shorthand;
    const number = parseNumber(rawNumber);
    if (owner === undefined || repo === undefined) {
      return fail('Use the form owner/repo#number.');
    }
    if (number === null) {
      return fail('That pull request number is not a positive whole number.');
    }
    return { ok: true, value: { owner, repo, number } };
  }

  if (/^[^/\s]+#\d+$/.test(trimmed)) {
    return fail('Include the owner, as in owner/repo#number.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return fail('That is not a GitHub pull request URL or an owner/repo#number reference.');
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
    return fail('That URL does not point at a pull request.');
  }
  if (kind === undefined) {
    return fail('That URL points at a repository, not a pull request.');
  }
  if (kind !== 'pull') {
    return fail(`That URL points at "${kind}", not a pull request.`);
  }

  const number = parseNumber(rawNumber);
  if (number === null) {
    return fail('That pull request number is missing or not a positive whole number.');
  }

  return { ok: true, value: { owner, repo, number } };
}
