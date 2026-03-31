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
 * Sanitize user input for safe use in FTS5 MATCH expressions.
 *
 * FTS5 query syntax includes operators (AND, OR, NOT, NEAR), column filters
 * (column:term), wildcards (*), prefix/caret (^), and phrase quotes ("...").
 * Unsanitized user input can cause FTS5 syntax errors (unbalanced quotes) or
 * injection (column filters, boolean operators changing query semantics).
 *
 * Strategy: Escape all double-quotes within the input by doubling them,
 * then wrap the entire query in double quotes to force FTS5 to treat it as
 * a literal phrase. This neutralizes ALL FTS5 operators, column filters,
 * and special syntax while preserving the search intent.
 *
 * Invariant: I-P2-06 (error containment), DC-P2-008 (syntax error defense)
 *
 * @param query - Raw user search input (already trimmed, non-empty)
 * @returns Sanitized string safe for FTS5 MATCH
 */
export function sanitizeFts5Query(query: string): string {
  // Step 1: Escape any existing double-quotes by doubling them.
  // FTS5 phrase queries use "..." and "" is the escape for a literal quote.
  const escaped = query.replace(/"/g, '""');

  // Step 2: Wrap in double quotes to create a phrase query.
  // This neutralizes: AND, OR, NOT, NEAR, *, ^, +, -, column:term syntax.
  // FTS5 treats the entire content as a literal phrase to match.
  return `"${escaped}"`;
}
