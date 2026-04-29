/**
 * FR-008: Task-Aware Context Preparation.
 *
 * The surgeon's instrument tray -- Limen predicts what an agent needs
 * based on its role and task description, then returns exactly the right context.
 *
 * Architecture:
 *   1. Parse taskDescription for domain keywords
 *   2. Map keywords to predicate namespace patterns
 *   3. Call compile() (FR-006) for each section with proportional token budget
 *   4. Assemble sections into PreparedContext
 *   5. Track coverage + omissions
 *
 * CRITICAL: This module builds on top of compile() (FR-006).
 * It does NOT duplicate compilation logic. prepareForTask = smart predicate
 * selection + compile() + section splitting.
 *
 * Phase: v4.0.0 Phase 5
 * Spec ref: FR-008 (Task-Aware Context Preparation)
 *
 * Truth model:
 *   I-PREP-01: Empty taskDescription returns PREPARE_EMPTY_DESCRIPTION error
 *   I-PREP-02: Task keywords influence predicate selection
 *   I-PREP-03: maxTokens distributes across sections proportionally
 *   I-PREP-04: includeFindings controls finding.* inclusion
 *   I-PREP-05: coverage lists all included predicate namespaces
 *   I-PREP-06: omitted lists what was cut for budget
 *   I-PREP-07: text assembles all sections into reasoning-ready format
 *   I-PREP-08: Empty project domain (no matching claims) produces empty sections
 */

import type { Result } from '../kernel/interfaces/common.js';
import type { CompileOptions, CompiledContext } from './context_compiler.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for task-aware context preparation.
 * FR-008: The agent declares what it needs; Limen returns the right context.
 */
export interface PrepareForTaskOptions {
  /** Agent role (e.g., 'Builder', 'Breaker', 'Researcher'). */
  readonly agentRole: string;
  /** Subject pattern for project scope (e.g., 'entity:project:veridion'). */
  readonly project: string;
  /** Optional task identifier. */
  readonly taskId?: string;
  /** Natural language task description — drives keyword extraction. */
  readonly taskDescription: string;
  /** Token budget for total output. Default: 2000. */
  readonly maxTokens?: number;
  /** Include finding.* predicates. Default: true. */
  readonly includeFindings?: boolean;
  /** Include lock.* predicates. Default: false. */
  readonly includeLocks?: boolean;
  /** Include budget.* predicates. Default: false. */
  readonly includeBudget?: boolean;
}

/**
 * Result of task-aware context preparation.
 * FR-008: Reasoning-ready compiled context with semantic sections.
 */
export interface PreparedContext {
  /** Reasoning-ready compiled context (all sections assembled). */
  readonly text: string;
  /** Individual sections by predicate namespace. */
  readonly sections: {
    readonly decisions: string;
    readonly corrections: string;
    readonly constraints: string;
    readonly findings: string;
  };
  /** Approximate total token count. */
  readonly estimatedTokens: number;
  /** Which predicate namespaces were included. */
  readonly coverage: readonly string[];
  /** What was cut for token budget (namespaces or specific info). */
  readonly omitted: readonly string[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_TOKENS = 2000;
const CHARS_PER_TOKEN = 4;

/**
 * Core section definitions.
 * Each section maps to a predicate namespace and a display label.
 * Order matters -- decisions first (most important context for any agent).
 */
const CORE_SECTIONS = [
  { key: 'decisions', predicate: 'decision.*', label: 'DECISIONS', headerPrefix: 'Decisions' },
  { key: 'corrections', predicate: 'correction.*', label: 'CORRECTIONS', headerPrefix: 'Corrections (DO NOT)' },
  { key: 'constraints', predicate: 'constraint.*', label: 'CONSTRAINTS', headerPrefix: 'Constraints' },
  { key: 'findings', predicate: 'finding.*', label: 'FINDINGS', headerPrefix: 'Findings' },
] as const;

/**
 * Optional section definitions -- only included when explicitly requested.
 */
const OPTIONAL_SECTIONS = [
  { key: 'locks', predicate: 'lock.*', label: 'LOCKS', headerPrefix: 'Locks' },
  { key: 'budget', predicate: 'budget.*', label: 'BUDGET', headerPrefix: 'Budget' },
] as const;

/**
 * Keyword-to-predicate mapping.
 * Simple word matching: if any keyword appears in the task description,
 * include additional predicates beyond the core set.
 *
 * Design: This is intentionally simple word matching. An LLM is not needed
 * for this level of keyword extraction -- the predicate namespaces are
 * well-defined and the keywords are predictable.
 */
const KEYWORD_PREDICATE_MAP: ReadonlyMap<string, readonly string[]> = new Map([
  // Security domain
  ['auth', ['decision.auth*', 'correction.auth*', 'finding.auth*', 'warning.auth*']],
  ['security', ['decision.security*', 'correction.security*', 'finding.security*', 'warning.security*']],
  ['crypto', ['decision.crypto*', 'correction.crypto*', 'warning.crypto*']],
  ['token', ['decision.token*', 'correction.token*', 'warning.token*']],
  ['permission', ['decision.permission*', 'correction.permission*']],
  ['rbac', ['decision.rbac*', 'correction.rbac*', 'finding.rbac*']],
  // Architecture domain
  ['api', ['decision.api*', 'correction.api*', 'constraint.api*']],
  ['schema', ['decision.schema*', 'correction.schema*', 'constraint.schema*']],
  ['database', ['decision.database*', 'correction.database*', 'constraint.database*']],
  ['migration', ['decision.migration*', 'correction.migration*', 'constraint.migration*']],
  ['architecture', ['decision.arch*', 'correction.arch*', 'constraint.arch*']],
  ['design', ['decision.design*', 'correction.design*']],
  // Testing domain
  ['test', ['decision.test*', 'correction.test*', 'finding.test*', 'warning.test*']],
  ['breaker', ['finding.*', 'correction.*', 'warning.*']],
  // Performance domain
  ['performance', ['decision.perf*', 'constraint.perf*', 'finding.perf*']],
  ['latency', ['constraint.latency*', 'decision.latency*']],
  // Infrastructure
  ['deploy', ['decision.deploy*', 'constraint.deploy*', 'warning.deploy*']],
  ['infra', ['decision.infra*', 'constraint.infra*']],
]);

// ============================================================================
// Dependencies
// ============================================================================

/**
 * Dependencies for task preparation.
 * Uses compile() as the backbone -- no direct DB access needed.
 */
export interface TaskPreparationDeps {
  readonly compile: (options: CompileOptions) => Result<CompiledContext>;
}

// ============================================================================
// Result Helpers
// ============================================================================

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message, spec: 'FR-008' } };
}

// ============================================================================
// Core Implementation
// ============================================================================

/**
 * Prepare task-aware context for an agent.
 *
 * Five phases:
 *   1. Validate inputs
 *   2. Extract keywords from taskDescription
 *   3. Determine sections to include (core + optional)
 *   4. Distribute token budget proportionally
 *   5. Compile each section via compile() and assemble
 *
 * I-PREP-01: Empty taskDescription returns error.
 * I-PREP-02: Keywords influence predicate selection.
 * I-PREP-03: maxTokens distributes across sections.
 * I-PREP-04: includeFindings controls finding.* inclusion.
 */
export function prepareForTask(
  deps: TaskPreparationDeps,
  options: PrepareForTaskOptions,
): Result<PreparedContext> {
  // ── Phase 1: Validation ──
  // I-PREP-01: Empty taskDescription is an error -- an agent without
  // a task description cannot have its context tailored.
  if (!options.taskDescription || options.taskDescription.trim().length === 0) {
    return err('PREPARE_EMPTY_DESCRIPTION', 'taskDescription must be a non-empty string');
  }

  if (!options.project || options.project.trim().length === 0) {
    return err('PREPARE_EMPTY_PROJECT', 'project must be a non-empty string');
  }

  if (!options.agentRole || options.agentRole.trim().length === 0) {
    return err('PREPARE_EMPTY_ROLE', 'agentRole must be a non-empty string');
  }

  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (maxTokens <= 0) {
    return err('PREPARE_INVALID_MAX_TOKENS', 'maxTokens must be a positive number');
  }

  const includeFindings = options.includeFindings ?? true;
  const includeLocks = options.includeLocks ?? false;
  const includeBudget = options.includeBudget ?? false;

  try {
    // ── Phase 2: Extract keywords ──
    const keywords = extractKeywords(options.taskDescription);

    // ── Phase 3: Determine sections ──
    // Build the list of sections to compile.
    // Core sections are always included (except findings if disabled).
    const activeSections: Array<{
      key: string;
      predicates: readonly string[];
      headerPrefix: string;
    }> = [];

    for (const section of CORE_SECTIONS) {
      if (section.key === 'findings' && !includeFindings) continue;
      activeSections.push({
        key: section.key,
        predicates: [section.predicate],
        headerPrefix: section.headerPrefix,
      });
    }

    // Optional sections
    if (includeLocks) {
      activeSections.push({
        key: 'locks',
        predicates: [OPTIONAL_SECTIONS[0].predicate],
        headerPrefix: OPTIONAL_SECTIONS[0].headerPrefix,
      });
    }
    if (includeBudget) {
      activeSections.push({
        key: 'budget',
        predicates: [OPTIONAL_SECTIONS[1].predicate],
        headerPrefix: OPTIONAL_SECTIONS[1].headerPrefix,
      });
    }

    // Add keyword-derived predicates to relevant sections
    // Keywords add MORE predicates to existing sections (e.g., 'warning.auth*' goes
    // to the section that matches its primary namespace, or gets its own query).
    const keywordPredicates = derivePredicatesFromKeywords(keywords);

    // ── Phase 4: Distribute token budget ──
    // Reserve some tokens for the header and structure
    const headerBudget = 50; // ~200 chars for header
    const remainingBudget = Math.max(maxTokens - headerBudget, 100);
    const perSectionBudget = Math.floor(remainingBudget / activeSections.length);

    // ── Phase 5: Compile each section ──
    const sectionResults: Record<string, { text: string; tokens: number; claimCount: number }> = {};
    const coverage: string[] = [];
    const omitted: string[] = [];

    for (const section of activeSections) {
      // Merge core predicates with any keyword-derived predicates for this section
      const allPredicates = [...section.predicates, ...keywordPredicates];

      const compileResult = deps.compile({
        domain: options.project,
        predicates: allPredicates,
        format: 'reasoning-ready',
        maxTokens: perSectionBudget,
      });

      if (compileResult.ok) {
        const compiled = compileResult.value;
        if (compiled.claimCount > 0) {
          // Extract just the claim lines (skip header and "No claims found")
          const lines = compiled.text.split('\n');
          // Skip the "Context for ..." header line
          const claimLines = lines.filter(line =>
            !line.startsWith('Context for ') &&
            line.trim().length > 0 &&
            !line.includes('No claims found'),
          );
          const sectionText = claimLines.join('\n');

          sectionResults[section.key] = {
            text: sectionText,
            tokens: compiled.estimatedTokens,
            claimCount: compiled.claimCount,
          };

          // Track coverage -- the predicate namespace was included and had data
          const primaryPredicate = section.predicates[0] ?? section.key;
          coverage.push(primaryPredicate.replace('.*', ''));

          // Check if compile truncated
          if (compiled.text.includes('more claims omitted')) {
            omitted.push(`${section.key}: truncated by token budget`);
          }
        } else {
          sectionResults[section.key] = { text: '', tokens: 0, claimCount: 0 };
        }
      } else {
        // compile() error -- section is empty
        sectionResults[section.key] = { text: '', tokens: 0, claimCount: 0 };
        omitted.push(`${section.key}: compile error (${compileResult.error.code})`);
      }
    }

    // If findings was disabled, note it in omitted
    if (!includeFindings) {
      omitted.push('findings: excluded by includeFindings=false');
    }
    if (!includeLocks) {
      omitted.push('locks: excluded by includeLocks=false (default)');
    }
    if (!includeBudget) {
      omitted.push('budget: excluded by includeBudget=false (default)');
    }

    // ── Assemble final output ──
    const sections = {
      decisions: sectionResults['decisions']?.text ?? '',
      corrections: sectionResults['corrections']?.text ?? '',
      constraints: sectionResults['constraints']?.text ?? '',
      findings: sectionResults['findings']?.text ?? '',
    };

    // Build the reasoning-ready text
    const textParts: string[] = [];
    textParts.push(`=== Task Context for ${options.agentRole} ===`);
    textParts.push(`Project: ${options.project}`);
    if (options.taskId) {
      textParts.push(`Task: ${options.taskId}`);
    }
    textParts.push(`Description: ${options.taskDescription}`);
    textParts.push('');

    // Add each non-empty section
    if (sections.decisions.length > 0) {
      textParts.push('--- Decisions ---');
      textParts.push(sections.decisions);
      textParts.push('');
    }
    if (sections.corrections.length > 0) {
      textParts.push('--- Corrections (DO NOT) ---');
      textParts.push(sections.corrections);
      textParts.push('');
    }
    if (sections.constraints.length > 0) {
      textParts.push('--- Constraints ---');
      textParts.push(sections.constraints);
      textParts.push('');
    }
    if (sections.findings.length > 0) {
      textParts.push('--- Findings ---');
      textParts.push(sections.findings);
      textParts.push('');
    }

    // Add optional sections if present
    if (sectionResults['locks']?.text) {
      textParts.push('--- Locks ---');
      textParts.push(sectionResults['locks'].text);
      textParts.push('');
    }
    if (sectionResults['budget']?.text) {
      textParts.push('--- Budget ---');
      textParts.push(sectionResults['budget'].text);
      textParts.push('');
    }

    const text = textParts.join('\n');
    const estimatedTokens = Math.ceil(text.length / CHARS_PER_TOKEN);

    return ok({
      text,
      sections,
      estimatedTokens,
      coverage,
      omitted,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('PREPARE_FAILED', `Task preparation failed: ${msg}`);
  }
}

// ============================================================================
// Keyword Extraction
// ============================================================================

/**
 * Extract keywords from a task description.
 * Simple word tokenization: split on whitespace/punctuation, lowercase,
 * match against KEYWORD_PREDICATE_MAP keys.
 *
 * No LLM needed -- the predicate namespaces are well-defined
 * and the keywords are predictable English words.
 */
export function extractKeywords(taskDescription: string): readonly string[] {
  const normalized = taskDescription.toLowerCase();
  // Split on non-alphanumeric characters
  const words = normalized.split(/[^a-z0-9]+/).filter(w => w.length > 2);

  const matched: string[] = [];
  for (const word of words) {
    if (KEYWORD_PREDICATE_MAP.has(word)) {
      matched.push(word);
    }
  }

  // Deduplicate while preserving order
  return [...new Set(matched)];
}

/**
 * Derive additional predicate patterns from extracted keywords.
 * Returns patterns that can be added to section queries.
 */
function derivePredicatesFromKeywords(keywords: readonly string[]): readonly string[] {
  const predicates: string[] = [];

  for (const keyword of keywords) {
    const patterns = KEYWORD_PREDICATE_MAP.get(keyword);
    if (patterns) {
      predicates.push(...patterns);
    }
  }

  // Deduplicate
  return [...new Set(predicates)];
}
