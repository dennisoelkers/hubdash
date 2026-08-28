import type { PrKey } from '../types';

/**
 * Canonical identity for a PR. Owner and repo are lowercased because GitHub
 * treats them case-insensitively, so "Example/..." and "example/..." must
 * not both end up on the board.
 */
export function prKey(owner: string, repo: string, number: number): PrKey {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`;
}
