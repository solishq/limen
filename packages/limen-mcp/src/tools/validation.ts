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
