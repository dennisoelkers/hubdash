/**
 * Parses the dialog's comma-separated version field into ordered unique labels.
 *
 * Labels stay free text and stay in the order given: version schemes vary
 * between projects, so sorting them risks presenting a wrong order confidently
 * where the user's own order was already right.
 */
export function parseVersions(input: string): string[] {
  const seen = new Set<string>();
  const versions: string[] = [];

  for (const part of input.split(',')) {
    const version = part.trim();
    if (version === '' || seen.has(version)) continue;
    seen.add(version);
    versions.push(version);
  }

  return versions;
}
