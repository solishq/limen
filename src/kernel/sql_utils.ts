/**
 * Shared SQL utility functions.
 *
 * Extracted to eliminate duplication across claim_stores, erasure_engine, and export.
 * P2-DRY-001: Single source of truth for SQL LIKE wildcard escaping.
 */

/**
 * Escape SQL LIKE wildcard characters in user input.
 * Prevents '%' and '_' from being interpreted as wildcards in LIKE clauses.
 *
 * @param input - Raw user input string
 * @returns Escaped string safe for use in SQL LIKE patterns
 */
export function escapeLikeWildcards(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
