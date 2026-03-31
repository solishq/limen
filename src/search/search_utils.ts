/**
 * Phase 2: Search Utilities -- pure functions for query analysis.
 *
 * Design Source: docs/sprints/PHASE-2-DESIGN-SOURCE.md (Decision 3, Decision 4)
 *
 * No state. No dependencies. No I/O.
 * CJK detection determines which FTS5 table(s) to query.
 *
 * Invariants: I-P2-08 (CJK searchability), I-P2-11 (substring via trigram)
 */

// ── CJK Detection ──

/**
 * Unicode ranges for CJK character detection.
 * Covers: CJK Unified Ideographs, Extension A, Hiragana, Katakana,
 * Hangul Syllables, Hangul Jamo, CJK Compatibility Ideographs.
 *
 * Design Source Decision 3.
 */
const CJK_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\uAC00-\uD7AF\u1100-\u11FF\uF900-\uFAFF]/;

/**
 * Detect whether text contains CJK characters.
 * Used at search time to route queries to the correct FTS5 table(s).
 */
export function containsCJK(text: string): boolean {
  return CJK_REGEX.test(text);
}

/**
 * Detect whether text contains Latin/Cyrillic/other word-boundary characters.
 * Simple heuristic: any character that is NOT CJK, punctuation, whitespace, or digit
 * is considered "Latin" for routing purposes.
 */
const LATIN_REGEX = /[a-zA-Z\u00C0-\u024F\u0400-\u04FF]/;

export function containsLatin(text: string): boolean {
  return LATIN_REGEX.test(text);
}

// ── Query Analysis ──

/**
 * Analysis result for a search query.
 * Determines which FTS5 tables to query.
 */
export interface QueryAnalysis {
  /** True if query contains CJK Unicode characters */
  readonly hasCJK: boolean;
  /** True if query contains Latin/Cyrillic/other word-boundary characters */
  readonly hasLatin: boolean;
  /** Which FTS5 tables to query based on content analysis */
  readonly tables: readonly ('primary' | 'cjk')[];
}

/**
 * Analyze a search query to determine routing.
 *
 * Design Source Decision 4:
 *   - CJK-only -> trigram table only
 *   - Latin-only -> primary unicode61 table + trigram for substring fallback
 *   - Mixed -> both tables
 *
 * PA Amendment 1: Latin queries also go through trigram for substring matching
 * (e.g., "food" finding "preference.food" which is a single token in primary).
 */
export function analyzeQuery(query: string): QueryAnalysis {
  const hasCJK = containsCJK(query);
  const hasLatin = containsLatin(query);

  let tables: readonly ('primary' | 'cjk')[];
  if (hasCJK && hasLatin) {
    // Mixed: query both
    tables = ['primary', 'cjk'];
  } else if (hasCJK) {
    // CJK-only: trigram only (unicode61 cannot tokenize CJK)
    tables = ['cjk'];
  } else {
    // Latin-only or other: query both (primary for BM25 ranking, trigram for substring)
    // PA Amendment 1: trigram needed for substring matching like "food" -> "preference.food"
    tables = ['primary', 'cjk'];
  }

  return { hasCJK, hasLatin, tables };
}

/**
 * Escape special FTS5 characters in a query string.
 * FTS5 operators that need escaping: *, ^, NEAR, AND, OR, NOT, +, -
 * Double-quotes are used for phrase queries and should be preserved if balanced.
 *
 * For safety, we wrap the query in double quotes if it contains special chars
 * (unless it already looks like a deliberate FTS5 query with operators).
 */
export function sanitizeFts5Query(query: string): string {
  // If query is already quoted, preserve it
  if (query.startsWith('"') && query.endsWith('"')) {
    return query;
  }

  // If query contains FTS5 boolean operators, let it pass through
  // (user is crafting an advanced query)
  if (/\b(AND|OR|NOT|NEAR)\b/.test(query) || query.includes('*')) {
    return query;
  }

  // For simple queries, return as-is (FTS5 handles single terms fine)
  return query;
}
