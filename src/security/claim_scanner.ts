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
    regex: /you\s+are\s+now/i,
    severity: 'medium',
  },
  {
    name: 'act_as',
    regex: /\bact\s+as\b/i,
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
 * Scan text for prompt injection patterns.
 *
 * @param text - Concatenated claim content to scan
 * @returns InjectionScanResult with detected patterns and severity
 */
function scanForInjection(text: string): InjectionScanResult {
  const matchedPatterns: string[] = [];
  let maxSeverity: InjectionSeverity = 'none';

  for (const pattern of INJECTION_PATTERNS) {
    // Reset lastIndex for global-capable regex
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(text)) {
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
  // PII scan
  const pii = policy.pii.enabled
    ? scanForPii(fields, policy.pii.categories)
    : { hasPii: false, matches: [] as const, categories: [] as const };

  // Injection scan — concatenate all fields for comprehensive detection
  const fullText = `${fields.subject}\n${fields.predicate}\n${fields.objectValue}`;
  const injection = policy.injection.enabled
    ? scanForInjection(fullText)
    : { detected: false, patterns: [] as const, severity: 'none' as const };

  return {
    pii,
    injection,
    scannedAt: time.nowISO(),
  };
}
