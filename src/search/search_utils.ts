// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
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
 * Strategy (FINDING-016 fix): Split into individual terms, escape each by
 * wrapping in double quotes. This produces implicit AND between terms rather
 * than a strict phrase match. Each quoted term is matched independently,
 * allowing multi-word queries like "auth timeout" to match documents containing
 * both words anywhere in the content (not necessarily adjacent).
 *
 * For the trigram table, each quoted term matches as an independent substring,
 * so "auth" matches "authentication" and "timeout" matches "timeout" — both
 * must be present for the document to match.
 *
 * Security: Each term is individually quoted, which neutralizes ALL FTS5
 * operators (AND, OR, NOT, NEAR), column filters (column:term), wildcards (*),
 * prefix/caret (^), and special syntax within each term.
 *
 * Invariant: I-P2-06 (error containment), DC-P2-008 (syntax error defense)
 *
 * @param query - Raw user search input (already trimmed, non-empty)
 * @returns Sanitized string safe for FTS5 MATCH
 */
export function sanitizeFts5Query(query: string): string {
  // Step 1: Split into whitespace-delimited terms, filter empties.
  const terms = query.split(/\s+/).filter(t => t.length > 0);

  // Step 2: Escape each term individually — double any embedded quotes,
  // then wrap in double quotes. This neutralizes all FTS5 special syntax
  // within each term while allowing implicit AND between terms.
  const escapedTerms = terms.map(term => {
    const escaped = term.replace(/"/g, '""');
    return `"${escaped}"`;
  });

  // Step 3: Join with space — FTS5 uses implicit AND between terms.
  // If query was all whitespace (shouldn't reach here due to caller checks),
  // fall back to the original escaped-phrase approach for safety.
  return escapedTerms.length > 0
    ? escapedTerms.join(' ')
    : `"${query.replace(/"/g, '""')}"`;
}
