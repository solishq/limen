/**
 * Phase 9: PII Detector — Pattern-based PII detection.
 *
 * Spec ref: PHASE-9-DESIGN-SOURCE.md (Output 1, PII Detector)
 * Invariants: I-P9-01 (PII flag consistency), I-P9-02 (PII non-leakage)
 * DCs: DC-P9-101, DC-P9-102, DC-P9-701, DC-P9-702, DC-P9-801-806, DC-P9-901
 *
 * Pure function. Takes text, returns PiiScanResult.
 * Regex compiled once at module load, reused for all scans.
 * Target: < 1ms per scan for claims under 500 chars.
 *
 * I-P9-02: PII matches store offset + length + confidence, NOT matched text.
 */

import type { PiiCategory, PiiMatch, PiiScanResult } from './security_types.js';

// ============================================================================
// Compiled regex patterns — created once at module load time.
// DC-P9-901: Performance critical — reuse compiled regex.
// ============================================================================

interface PiiPattern {
  readonly category: PiiCategory;
  readonly regex: RegExp;
  readonly confidence: number;
  readonly validate?: (match: string) => boolean;
}

/**
 * Luhn algorithm for credit card validation.
 * DC-P9-804: Only valid Luhn numbers are flagged.
 */
function passesLuhn(digits: string): boolean {
  const nums = digits.replace(/\D/g, '');
  if (nums.length < 13 || nums.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = nums.length - 1; i >= 0; i--) {
    let n = parseInt(nums[i]!, 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * Validate IPv4 octet range (0-255).
 */
function isValidIPv4(match: string): boolean {
  const octets = match.split('.');
  if (octets.length !== 4) return false;
  return octets.every(o => {
    const n = parseInt(o!, 10);
    return n >= 0 && n <= 255;
  });
}

/**
 * Validate phone number has at least 7 digits.
 */
function hasMinPhoneDigits(match: string): boolean {
  const digits = match.replace(/\D/g, '');
  return digits.length >= 7;
}

const PII_PATTERNS: readonly PiiPattern[] = [
  {
    category: 'email',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    confidence: 0.95,
  },
  {
    category: 'ssn',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.9,
  },
  {
    category: 'credit_card',
    // 13-19 digit sequences (with optional separators)
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    confidence: 0.85,
    validate: passesLuhn,
  },
  {
    category: 'ip_address',
    regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    confidence: 0.8,
    validate: isValidIPv4,
  },
  {
    category: 'phone',
    // F-P9-002: Requires at least one separator (dash, space, dot) between digit groups,
    // OR a leading '+' with country code. Prevents false positives on standalone 8-digit numbers.
    regex: /(?:\+\d{1,3}[-.\s])\(?\d{1,4}\)?[-.\s]\d{1,4}[-.\s]?\d{1,9}|\(?\d{1,4}\)?[-.\s]\d{1,4}[-.\s]\d{1,9}/g,
    confidence: 0.75,
    validate: hasMinPhoneDigits,
  },
];

// ============================================================================
// PII Scanning Functions
// ============================================================================

/**
 * Scan a single text field for PII.
 *
 * @param text - The text to scan
 * @param field - The field name (subject, predicate, objectValue)
 * @param categories - Which PII categories to detect
 * @returns Array of PiiMatch results (without matched text — I-P9-02)
 */
function scanField(
  text: string,
  field: PiiMatch['field'],
  categories: readonly PiiCategory[],
): PiiMatch[] {
  const matches: PiiMatch[] = [];

  for (const pattern of PII_PATTERNS) {
    if (!categories.includes(pattern.category)) continue;

    // Reset lastIndex for global regex reuse
    pattern.regex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      // Run additional validation if present
      if (pattern.validate && !pattern.validate(match[0])) continue;

      // I-P9-02: Store offset + length, NOT matched text
      matches.push({
        category: pattern.category,
        field,
        offset: match.index,
        length: match[0].length,
        confidence: pattern.confidence,
      });
    }
  }

  return matches;
}

/**
 * Scan claim content fields for PII.
 *
 * Pure function. Takes field values and categories, returns PiiScanResult.
 * DC-P9-901: Target < 1ms for claims under 500 chars.
 *
 * @param fields - Object with subject, predicate, objectValue strings
 * @param categories - Which PII categories to detect
 * @returns PiiScanResult with matches, categories, and hasPii flag
 */
export function scanForPii(
  fields: {
    readonly subject: string;
    readonly predicate: string;
    readonly objectValue: string;
  },
  categories: readonly PiiCategory[],
): PiiScanResult {
  if (categories.length === 0) {
    return { hasPii: false, matches: [], categories: [] };
  }

  const allMatches: PiiMatch[] = [
    ...scanField(fields.subject, 'subject', categories),
    ...scanField(fields.predicate, 'predicate', categories),
    ...scanField(fields.objectValue, 'objectValue', categories),
  ];

  // Deduplicate categories
  const detectedCategories: PiiCategory[] = [];
  for (const m of allMatches) {
    if (!detectedCategories.includes(m.category)) {
      detectedCategories.push(m.category);
    }
  }

  return {
    hasPii: allMatches.length > 0,
    matches: allMatches,
    categories: detectedCategories,
  };
}
