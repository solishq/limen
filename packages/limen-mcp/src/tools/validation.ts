// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Shared MCP Write Validation — unified guard for all write paths.
 *
 * Addresses findings:
 *   NEW-01 (P0): Consent gate must apply to all write paths with PII predicates.
 *   NEW-02 (P1): Control character rejection on all write inputs.
 *   NEW-03 (P2): Control character rejection on a2a_send message field.
 *   NEW-04 (P2): Case-insensitive PII prefix matching.
 *
 * Structural fix: extracting shared validation prevents class-of-finding recurrence
 * for any future write tools.
 */

// ── PII Predicate Detection (NEW-04: case-insensitive) ──

const PII_PREDICATE_PREFIXES: readonly string[] = [
  'personal.',
  'user.',
  'identity.',
];

/**
 * Check if a predicate indicates personal data requiring consent.
 * NEW-04 fix: normalizes to lowercase before prefix comparison.
 */
export function isPiiPredicate(predicate: string): boolean {
  const lower = predicate.toLowerCase();
  return PII_PREDICATE_PREFIXES.some(prefix => lower.startsWith(prefix));
}

// ── PII Value Detection (F-SEC-005) ──

/**
 * F-SEC-005: Detect PII patterns in claim values.
 *
 * Scans text for common PII patterns: email addresses, SSN-like numbers,
 * and phone numbers. This catches cases where PII is stored under
 * non-PII predicates (bypassing the predicate-prefix check).
 *
 * Returns true if any PII pattern is detected in the value.
 */

/** Email: simplified RFC 5322 local@domain pattern. */
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/** SSN: XXX-XX-XXXX or XXXXXXXXX (US Social Security Number format). */
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b/;

/** Phone: international format (+1...) or US format ((xxx) xxx-xxxx, xxx-xxx-xxxx). */
const PHONE_REGEX = /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,9}|\(\d{3}\)\s?\d{3}[.-]?\d{4}|\b\d{3}[.-]\d{3}[.-]\d{4}\b/;

export function containsPiiValue(value: string): boolean {
  return EMAIL_REGEX.test(value) || SSN_REGEX.test(value) || PHONE_REGEX.test(value);
}

// ── Control Character Detection (NEW-02, NEW-03) ──

/**
 * Regex matching control characters U+0000-U+001F except \n (0x0A),
 * \r (0x0D), and \t (0x09). Rejects null bytes and related attacks.
 */
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

/**
 * Returns true if the string contains dangerous control characters.
 * Allows \n, \r, \t as they are legitimate in text content.
 */
export function containsControlChars(value: string): boolean {
  return CONTROL_CHAR_REGEX.test(value);
}
