const VERSION_TOKEN = /\bv?(\d+\.\d+(?:\.\d+)?)\b/gi;

/**
 * Scans a PR body for lines that mention "backport" and pulls every
 * version-shaped token out of each one. Order is preserved as written, not
 * sorted, for the same reason manually-typed versions are never sorted
 * (spec round 1 §6: version schemes vary, and a wrong sort is worse than the
 * order the PR's own author chose).
 */
export function detectBackportVersions(body: string): string[] {
  const seen = new Set<string>();
  const versions: string[] = [];

  for (const line of body.split('\n')) {
    if (!line.toLowerCase().includes('backport')) continue;

    for (const match of line.matchAll(VERSION_TOKEN)) {
      const version = match[1];
      if (version === undefined || seen.has(version)) continue;
      seen.add(version);
      versions.push(version);
    }
  }

  return versions;
}
