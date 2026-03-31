/**
 * Phase 1 §1.7: System prompt instructions generator.
 *
 * Pure function -- no I/O, deterministic output.
 * Generates a multi-line string teaching an AI agent how to use Limen.
 *
 * Invariant: I-CONV-18 (pure function, same output every call)
 */

/**
 * Generate system prompt instructions for AI agents using Limen.
 *
 * Returns a multi-line string suitable for injection into an AI agent's
 * system prompt. Teaches the agent how to use remember(), recall(),
 * forget(), connect(), and reflect().
 *
 * Pure function: no I/O, no state, deterministic.
 */
export function generatePromptInstructions(): string {
  return `# Limen Knowledge System

You have access to a persistent knowledge system called Limen. Use it to store, retrieve, and manage beliefs about the world.

## Core Methods

### remember(subject, predicate, value, options?)
Store a belief with explicit subject, predicate, and value.
- subject: URN format "entity:<type>:<id>" (e.g., "entity:user:alice")
- predicate: dot-separated "<domain>.<property>" (e.g., "preference.language")
- value: string value of the belief
- options.confidence: 0.0-1.0 (default: 0.7, capped by maxAutoConfidence)
- options.groundingMode: 'runtime_witness' (default) or 'evidence_path'
- options.evidenceRefs: evidence references (required for evidence_path to bypass confidence cap)

### remember(text, options?)
Store a free-form observation. Subject auto-generated from content hash.
- text: non-empty observation text
- predicate defaults to 'observation.note'

### recall(subject?, predicate?, options?)
Retrieve beliefs matching filters.
- subject: filter by subject (optional, supports wildcards)
- predicate: filter by predicate (optional, supports wildcards)
- options.minConfidence: minimum confidence threshold
- options.includeSuperseded: include superseded beliefs (default: false)
- options.limit: max results (default: 50)
Returns: BeliefView[] with claimId, subject, predicate, value, confidence, validAt, createdAt, superseded, disputed.

### forget(claimId, reason?)
Retract a belief. The belief remains in the audit trail but is marked as retracted.
- claimId: the ID of the belief to retract
- reason: optional reason for retraction

### connect(claimId1, claimId2, type)
Create a relationship between two beliefs.
- type: 'supports' | 'contradicts' | 'supersedes' | 'derived_from'
- Direction: from claimId1 to claimId2

### reflect(entries)
Batch-store categorized learnings. All-or-nothing transaction.
- entries: array of { category, statement, confidence? }
- category: 'decision' | 'pattern' | 'warning' | 'finding'
- statement: max 500 characters

## Confidence Rules
- Default confidence: 0.7 (configurable via maxAutoConfidence)
- Claims are capped at maxAutoConfidence unless you provide evidence_path grounding with evidence references
- Higher confidence = stronger belief. Use sparingly for machine-generated observations.

## Best Practices
1. Use structured subjects (entity:<type>:<id>) for retrievability
2. Use consistent predicates within a domain (e.g., preference.*, status.*)
3. Use connect('supersedes') when updating a belief rather than just creating a new one
4. Use reflect() for batch operations -- it's transactional (all-or-nothing)
5. Check recall() before remember() to avoid duplicates`;
}
