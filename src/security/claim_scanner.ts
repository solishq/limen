/**
 * Phase 9: Claim Content Scanner — Orchestrates PII + Injection Detection.
 *
 * Spec ref: PHASE-9-DESIGN-SOURCE.md (Output 1, Claim Content Scanner)
 * Invariants: I-P9-01, I-P9-02, I-P9-10, I-P9-11
 * DCs: DC-P9-401, DC-P9-402, DC-P9-805, DC-P9-806
 *
 * This module:
 *   1. Detects prompt injection patterns in claim content (Step 4)
 *   2. Orchestrates PII detection + injection detection into ContentScanResult (Step 5)
 *
 * Pure function. No database access. No side effects.
 */

import type {
  ContentScanResult, InjectionScanResult, InjectionSeverity,
  SecurityPolicy,
} from './security_types.js';
import { scanForPii } from './pii_detector.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';

// ============================================================================
// Prompt Injection Detection (Step 4)
// ============================================================================

interface InjectionPattern {
  readonly name: string;
  readonly regex: RegExp;
  readonly severity: InjectionSeverity;
}

/**
 * Compiled injection patterns — created once at module load time.
 *
 * Severity levels:
 * - HIGH: explicit instruction override ("ignore previous", "disregard")
 * - MEDIUM: role hijacking ("you are now", "act as")
 * - LOW: structural patterns (role markers, code blocks with instructions)
 */
const INJECTION_PATTERNS: readonly InjectionPattern[] = [
  // HIGH: Explicit instruction override
  {
    name: 'ignore_previous_instructions',
    regex: /ignore\s+(?:all\s+)?previous\s+instructions/i,
    severity: 'high',
  },
  {
    name: 'ignore_all_prior',
    regex: /ignore\s+all\s+prior/i,
    severity: 'high',
  },
  {
    name: 'disregard_previous',
    regex: /disregard\s+(?:all\s+)?previous/i,
    severity: 'high',
  },
  {
    name: 'forget_everything',
    regex: /forget\s+everything/i,
    severity: 'high',
  },

  // MEDIUM: Role hijacking
  {
    name: 'system_prompt',
    regex: /system\s*prompt\s*:/i,
    severity: 'medium',
  },
  {
    name: 'you_are_now',
    // F-P9-012: Restrict to role hijacking context to avoid false positives
    regex: /you\s+are\s+now\s+(?:a\s+)?(?:system|AI|assistant|chatbot|bot|admin|root|DAN)\b/i,
    severity: 'medium',
  },
  {
    name: 'act_as',
    // F-P9-011: Restrict to role hijacking context to avoid false positives
    regex: /\bact\s+as\s+(?:a\s+)?(?:system|admin|root|AI|assistant|chatbot|bot|model)\b/i,
    severity: 'medium',
  },

  // LOW: Structural patterns
  {
    name: 'role_injection_human',
    regex: /\n\nHuman:/,
    severity: 'low',
  },
  {
    name: 'role_injection_assistant',
    regex: /\n\nAssistant:/,
    severity: 'low',
  },
  {
    name: 'code_block_instruction',
    regex: /```[\s\S]*?(?:ignore|override|forget|disregard)/i,
    severity: 'low',
  },
];

/**
 * Severity ordering for determining the highest severity found.
 */
const SEVERITY_ORDER: Record<InjectionSeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * F-P9-013/014: Strip zero-width characters and apply Unicode NFC normalization.
 * Prevents bypass via zero-width char insertion or homoglyph substitution.
 */
function normalizeForScan(text: string): string {
  // Strip zero-width characters: U+200B (ZWSP), U+200C (ZWNJ), U+200D (ZWJ), U+FEFF (BOM)
  const stripped = text.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
  // Apply NFC normalization to collapse composed characters
  return stripped.normalize('NFC');
}

/**
 * Scan text for prompt injection patterns.
 *
 * @param text - Claim content field to scan
 * @returns InjectionScanResult with detected patterns and severity
 */
function scanForInjection(text: string): InjectionScanResult {
  // F-P9-013/014: Normalize before pattern matching to defeat Unicode bypass
  const normalized = normalizeForScan(text);
  const matchedPatterns: string[] = [];
  let maxSeverity: InjectionSeverity = 'none';

  for (const pattern of INJECTION_PATTERNS) {
    // Reset lastIndex for global-capable regex
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(normalized)) {
      matchedPatterns.push(pattern.name);
      if (SEVERITY_ORDER[pattern.severity] > SEVERITY_ORDER[maxSeverity]) {
        maxSeverity = pattern.severity;
      }
    }
  }

  return {
    detected: matchedPatterns.length > 0,
    patterns: matchedPatterns,
    severity: maxSeverity,
  };
}

/**
 * F-P9-019: Merge multiple per-field injection scan results into one.
 * Deduplicates pattern names and takes the highest severity.
 */
function mergeInjectionResults(results: InjectionScanResult[]): InjectionScanResult {
  const allPatterns: string[] = [];
  let maxSeverity: InjectionSeverity = 'none';

  for (const r of results) {
    for (const p of r.patterns) {
      if (!allPatterns.includes(p)) allPatterns.push(p);
    }
    if (SEVERITY_ORDER[r.severity] > SEVERITY_ORDER[maxSeverity]) {
      maxSeverity = r.severity;
    }
  }

  return {
    detected: allPatterns.length > 0,
    patterns: allPatterns,
    severity: maxSeverity,
  };
}

// ============================================================================
// Claim Content Scanner (Step 5)
// ============================================================================

/**
 * Scan claim content for PII and prompt injection.
 *
 * Orchestrates both scanners. Returns combined ContentScanResult.
 * Called by assertClaim handler between validation and INSERT.
 *
 * @param fields - Claim fields to scan
 * @param policy - Security policy configuration
 * @param time - TimeProvider for scannedAt timestamp (Hard Stop #7)
 * @returns ContentScanResult
 */
export function scanClaimContent(
  fields: {
    readonly subject: string;
    readonly predicate: string;
    readonly objectValue: string;
  },
  policy: SecurityPolicy,
  time: TimeProvider,
): ContentScanResult {
  // F-P9-013/014: Normalize fields before PII scan to defeat zero-width character
  // and Unicode bypass. Same normalization applied to injection scan below.
  const normalizedFields = policy.pii.enabled || policy.injection.enabled
    ? {
        subject: normalizeForScan(fields.subject),
        predicate: normalizeForScan(fields.predicate),
        objectValue: normalizeForScan(fields.objectValue),
      }
    : fields;

  // PII scan (against normalized text to prevent zero-width char evasion)
  const pii = policy.pii.enabled
    ? scanForPii(normalizedFields, policy.pii.categories)
    : { hasPii: false, matches: [] as const, categories: [] as const };

  // F-P9-019: Scan each field independently to prevent false injection detection
  // from field concatenation creating double-newlines (e.g., empty predicate + "Human:" objectValue).
  // Uses pre-normalized fields for consistency with PII scan.
  const injection = policy.injection.enabled
    ? mergeInjectionResults([
        scanForInjection(normalizedFields.subject),
        scanForInjection(normalizedFields.predicate),
        scanForInjection(normalizedFields.objectValue),
      ])
    : { detected: false, patterns: [] as const, severity: 'none' as const };

  return {
    pii,
    injection,
    scannedAt: time.nowISO(),
  };
}
