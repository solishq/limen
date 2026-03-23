/**
 * Limen — ColdStartManager Implementation
 * Phase 4E-2e: Learning System Convergence Subsystems
 *
 * Implements the ColdStartManager interface from learning_types.ts.
 * Pre-built technique templates for new agents. Confidence 0.6.
 *
 * S ref: S29.9 (cold-start templates), BRK-S29-001 (template versioning)
 *
 * Engineering decisions:
 *   D1: Templates are hardcoded in-memory. Spec defines 5 templates (customer-support,
 *       document-qa, code-assistant, claims-processor, research-analyst). Additional
 *       templates (e.g., sales-default) are included for domain coverage.
 *   D2: Cold-start provenance: sourceMemoryIds = ['cold-start:template:<templateId>'].
 *       store.create() enforces non-empty sourceMemoryIds (S29.3 Step 4). Cold-start
 *       techniques don't originate from memories — the template IS the provenance source.
 *       This satisfies the validation while correctly representing origin.
 *   D3: getAvailableTemplates() takes no parameters (no conn needed). Templates are
 *       in-memory constants, not database-backed.
 *   D4: applyTemplate() creates ALL techniques atomically. If any create fails, the
 *       entire operation fails. store.create() handles per-technique audit internally.
 *   D5: Idempotent application. Applying the same template twice returns the existing
 *       techniques instead of creating duplicates. Checked via getBySourceMemory with
 *       the cold-start provenance pattern, filtered by agentId. BRK-IMPL-004.
 */

import type {
  ColdStartManager, ColdStartTemplate, Technique,
  TechniqueStore,
} from '../interfaces/index.js';
import { INITIAL_CONFIDENCE_COLD_START } from '../interfaces/index.js';
import type {
  DatabaseConnection, OperationContext, Result, AgentId, TenantId,
} from '../../kernel/interfaces/index.js';

// ─── Template Definitions (§29.9) ───

const TEMPLATES: readonly ColdStartTemplate[] = Object.freeze([
  {
    templateId: 'customer-support',
    name: 'Customer Support',
    version: 1,
    techniques: Object.freeze([
      { type: 'prompt_fragment' as const, content: 'Acknowledge the customer\'s frustration before offering solutions.' },
      { type: 'decision_rule' as const, content: 'If customer has waited >24h for a response, escalate to priority queue.' },
      { type: 'rag_pattern' as const, content: 'Retrieve customer\'s recent ticket history before composing a response.' },
    ]),
  },
  {
    templateId: 'document-qa',
    name: 'Document Q&A',
    version: 1,
    techniques: Object.freeze([
      { type: 'prompt_fragment' as const, content: 'Quote the relevant document section before providing an answer.' },
      { type: 'decision_rule' as const, content: 'If the answer is not in the provided documents, say so explicitly rather than guessing.' },
      { type: 'rag_pattern' as const, content: 'Retrieve the top 3 most relevant document sections by semantic similarity.' },
    ]),
  },
  {
    templateId: 'code-assistant',
    name: 'Code Assistant',
    version: 1,
    techniques: Object.freeze([
      { type: 'prompt_fragment' as const, content: 'Include the programming language and version context in every code suggestion.' },
      { type: 'decision_rule' as const, content: 'If code has security implications, flag them explicitly before providing the solution.' },
      { type: 'rag_pattern' as const, content: 'Retrieve the project\'s existing code patterns before suggesting new implementations.' },
    ]),
  },
  {
    templateId: 'claims-processor',
    name: 'Claims Processor',
    version: 1,
    techniques: Object.freeze([
      { type: 'prompt_fragment' as const, content: 'State the claim ID and status at the beginning of every response.' },
      { type: 'decision_rule' as const, content: 'If claim amount exceeds threshold, require supervisor approval before proceeding.' },
      { type: 'rag_pattern' as const, content: 'Retrieve similar past claims and their resolutions for reference.' },
    ]),
  },
  {
    templateId: 'research-analyst',
    name: 'Research Analyst',
    version: 1,
    techniques: Object.freeze([
      { type: 'prompt_fragment' as const, content: 'Cite sources with author, date, and publication for every factual claim.' },
      { type: 'decision_rule' as const, content: 'If sources conflict, present both perspectives with confidence assessment.' },
      { type: 'rag_pattern' as const, content: 'Retrieve the most recent publications first, then expand to historical sources.' },
    ]),
  },
  {
    templateId: 'sales-default',
    name: 'Sales Default',
    version: 1,
    techniques: Object.freeze([
      { type: 'prompt_fragment' as const, content: 'When discussing pricing, always mention the annual discount option first.' },
      { type: 'decision_rule' as const, content: 'If customer mentions budget constraints, offer a tiered pricing breakdown.' },
      { type: 'rag_pattern' as const, content: 'Retrieve product comparison data when customer asks about alternatives.' },
    ]),
  },
]);

// ─── Factory ───

/**
 * Create a ColdStartManager implementation.
 * Follows the Limen store pattern: factory → Object.freeze.
 *
 * S29.9: Pre-built technique templates. Confidence 0.6.
 * BRK-S29-001: Templates must have version >= 1.
 */
export function createColdStartManager(store: TechniqueStore): ColdStartManager {

  // D3: getAvailableTemplates takes no parameters — templates are in-memory
  function getAvailableTemplates(): Result<readonly ColdStartTemplate[]> {
    return { ok: true, value: TEMPLATES };
  }

  // D4: Creates ALL template techniques via store.create()
  function applyTemplate(
    conn: DatabaseConnection,
    ctx: OperationContext,
    agentId: AgentId,
    tenantId: TenantId,
    templateId: string,
  ): Result<readonly Technique[]> {
    const template = TEMPLATES.find(t => t.templateId === templateId);

    if (!template) {
      return {
        ok: false,
        error: {
          code: 'TEMPLATE_NOT_FOUND',
          message: `Cold-start template '${templateId}' not found`,
          spec: 'S29.9',
        },
      };
    }

    // D5: Idempotency check — if template already applied to this agent, return existing
    const provenanceId = `cold-start:template:${templateId}`;
    const existingResult = store.getBySourceMemory(conn, provenanceId, tenantId);
    if (existingResult.ok) {
      const agentTechniques = existingResult.value.filter(t => t.agentId === agentId);
      if (agentTechniques.length > 0) {
        return { ok: true, value: agentTechniques };
      }
    }

    const techniques: Technique[] = [];

    // D2: Provenance = template reference (store.create requires non-empty sourceMemoryIds)
    const sourceMemoryIds = [provenanceId];

    for (const entry of template.techniques) {
      const createResult = store.create(conn, ctx, {
        tenantId,
        agentId,
        type: entry.type,
        content: entry.content,
        sourceMemoryIds,
        initialConfidence: INITIAL_CONFIDENCE_COLD_START, // 0.6 per S29.9
      });

      if (!createResult.ok) {
        return createResult as Result<readonly Technique[]>;
      }

      techniques.push(createResult.value);
    }

    return { ok: true, value: techniques };
  }

  return Object.freeze({ applyTemplate, getAvailableTemplates });
}
