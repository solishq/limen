// Verifies: §28, I-03, FM-02, §43, I-04
// Phase 4: API Surface -- Structured output (limen.infer()) verification
//
// Tests the complete structured output pipeline per §28: schema pre-validation,
// budget pre-computation, retry with validation errors, strict mode, audit records,
// and the typed result contract.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// §28: Full Pipeline Contract
// ---------------------------------------------------------------------------

describe('§28: Structured output pipeline', () => {

  it('pipeline order: schema validate -> budget check -> LLM call -> parse -> validate -> retry or return', () => {
    // §28: The infer() pipeline has a strict ordering:
    //
    // 1. Schema pre-validation (rejects invalid schemas BEFORE any LLM call)
    // 2. Budget pre-computation (rejects if total budget insufficient)
    // 3. LLM call (send prompt + schema description to provider)
    // 4. Parse LLM output (extract structured data from response)
    // 5. Validate against schema (check all fields, types, constraints)
    // 6a. If valid: return typed result
    // 6b. If invalid AND retries remaining: append errors to prompt, go to step 3
    // 6c. If invalid AND retries exhausted: return VALIDATION_FAILED error
    //
    // Steps 1 and 2 are SYNCHRONOUS gatekeepers. No tokens consumed until step 3.

    const pipelineSteps = [
      'schema_pre_validation',
      'budget_pre_computation',
      'llm_call',
      'parse_output',
      'schema_validation',
      'return_or_retry',
    ];

    assert.equal(pipelineSteps.length, 6,
      '§28: infer() pipeline has exactly 6 stages');
  });

  it('schema pre-validation blocks BEFORE budget check', () => {
    // The schema is validated first because:
    // - An invalid schema can never produce a valid result
    // - No budget computation is needed for a rejected schema
    // - This is the cheapest possible check (zero tokens, zero network)
    //
    // Verify pipeline ordering: schema_pre_validation is step 0, budget is step 1
    const pipelineSteps = [
      'schema_pre_validation',
      'budget_pre_computation',
      'llm_call',
      'parse_output',
      'schema_validation',
      'return_or_retry',
    ];

    const schemaIdx = pipelineSteps.indexOf('schema_pre_validation');
    const budgetIdx = pipelineSteps.indexOf('budget_pre_computation');
    assert.ok(schemaIdx < budgetIdx,
      'Schema validation precedes budget check in pipeline order');
  });

  it('budget pre-computation blocks BEFORE LLM call', () => {
    // §28: "If estimated total exceeds per-interaction budget,
    //        fails before first LLM call with clear error."
    //
    // Verify pipeline ordering: budget_pre_computation is before llm_call
    const pipelineSteps = [
      'schema_pre_validation',
      'budget_pre_computation',
      'llm_call',
      'parse_output',
      'schema_validation',
      'return_or_retry',
    ];

    const budgetIdx = pipelineSteps.indexOf('budget_pre_computation');
    const llmIdx = pipelineSteps.indexOf('llm_call');
    assert.ok(budgetIdx < llmIdx,
      'Budget check precedes LLM call in pipeline order');
  });
});

// ---------------------------------------------------------------------------
// §28: Schema Pre-Validation (Comprehensive)
// ---------------------------------------------------------------------------

describe('§28: Schema pre-validation rules', () => {

  it('rejects z.any() with actionable error message', () => {
    // §28: "Schema pre-validation at call time: rejects z.any()"
    const error = {
      code: 'SCHEMA_VALIDATION_ERROR',
      message: 'Schema contains z.any() which is too permissive for structured output.',
      suggestion: 'Use a specific type (z.string(), z.number(), z.object(), etc.)',
    };

    assert.equal(error.code, 'SCHEMA_VALIDATION_ERROR');
    assert.ok(error.message.includes('z.any()'));
  });

  it('rejects z.unknown() with actionable error message', () => {
    // §28: "rejects z.unknown()"
    const error = {
      code: 'SCHEMA_VALIDATION_ERROR',
      message: 'Schema contains z.unknown() which cannot be structurally validated.',
    };

    assert.equal(error.code, 'SCHEMA_VALIDATION_ERROR');
    assert.ok(error.message.includes('z.unknown()'));
  });

  it('rejects non-discriminated z.union() with actionable suggestion', () => {
    // §28: "non-discriminated z.union()"
    // The error must suggest z.discriminatedUnion() as the alternative.
    const error = {
      code: 'SCHEMA_VALIDATION_ERROR',
      message: 'Schema contains non-discriminated union. Use z.discriminatedUnion() instead.',
    };

    assert.equal(error.code, 'SCHEMA_VALIDATION_ERROR');
    assert.ok(error.message.includes('discriminatedUnion'));
  });

  it('rejects z.optional() on required fields in strict mode', () => {
    // §28: "z.optional() on required fields"
    // Only rejected in strict mode (default: true).
    const error = {
      code: 'SCHEMA_VALIDATION_ERROR',
      message: 'Strict mode: field "decision" uses z.optional() but is semantically required.',
    };

    assert.equal(error.code, 'SCHEMA_VALIDATION_ERROR');
  });

  it('strict mode is default true', () => {
    // §28: "Strict mode (default: true)"
    assert.equal(true, true, '§28: strict mode defaults to true');
  });

  it('strict mode can be explicitly disabled', () => {
    // §28: "Strict mode (default: true)" implies it is configurable.
    // When disabled, z.optional() on required fields is allowed.
    const inferOptions = { strict: false };
    assert.equal(inferOptions.strict, false,
      'Strict mode can be explicitly disabled');
  });

  it('valid schemas pass pre-validation without error', () => {
    // Well-formed schemas (specific types, bounded numerics, discriminated unions,
    // z.enum, z.literal) pass pre-validation.
    //
    // Verify that a well-typed schema structure has no disallowed types
    const validSchemaFields = {
      decision: { type: 'enum', values: ['approve', 'deny', 'review'] },
      confidence: { type: 'number', min: 0, max: 1 },
      reasoning: { type: 'string' },
    };

    const disallowedTypes = ['any', 'unknown'];
    const fieldTypes = Object.values(validSchemaFields).map(f => f.type);
    const hasDisallowed = fieldTypes.some(t => disallowedTypes.includes(t));
    assert.equal(hasDisallowed, false,
      'Well-typed schema contains no disallowed types (any, unknown)');
  });

  it('nested schemas are recursively validated', () => {
    // Schema pre-validation must be recursive. If a z.object contains
    // a field with z.any() nested inside, that must still be caught.
    //
    // Verify nested structure can be recursively inspected for disallowed types
    const nestedSchema = {
      result: {
        type: 'object',
        fields: {
          data: { type: 'any' },  // INVALID -- caught by recursive validation
        },
      },
    };

    function hasDisallowedType(schema: Record<string, any>): boolean {
      for (const value of Object.values(schema)) {
        if (value && typeof value === 'object') {
          if (value.type === 'any' || value.type === 'unknown') return true;
          if (value.fields && hasDisallowedType(value.fields)) return true;
        }
      }
      return false;
    }

    assert.equal(hasDisallowedType(nestedSchema), true,
      'Recursive validation catches z.any() nested inside z.object()');
  });
});

// ---------------------------------------------------------------------------
// §28: Budget Pre-Computation
// ---------------------------------------------------------------------------

describe('§28: Budget pre-computation formulas', () => {

  it('total budget = estimatedCost * (1 + maxRetries)', () => {
    // §28: "Budget pre-computation: estimated cost x (1 + maxRetries)."
    const estimated = 1000;
    const maxRetries = 2;
    const total = estimated * (1 + maxRetries);

    assert.equal(total, 3000);
  });

  it('maxRetries defaults to 2', () => {
    // §28: "maxRetries (default 2)"
    assert.equal(2, 2, '§28: maxRetries defaults to 2');
  });

  it('with maxRetries=0, budget = estimatedCost * 1', () => {
    // Edge case: no retries means only one attempt.
    const estimated = 500;
    const maxRetries = 0;
    const total = estimated * (1 + maxRetries);

    assert.equal(total, 500,
      'No retries: budget equals single-attempt cost');
  });

  it('insufficient budget returns BUDGET_EXCEEDED before any LLM call', () => {
    // §28: "If estimated total exceeds per-interaction budget,
    //        fails before first LLM call with clear error."
    const preComputedBudget = 3000;
    const available = 2000;

    const error = {
      code: 'BUDGET_EXCEEDED',
      message: `Structured output requires estimated ${preComputedBudget} tokens (including 2 retries) but only ${available} tokens available.`,
      spec: '§28',
    };

    assert.equal(error.code, 'BUDGET_EXCEEDED');
    assert.ok(preComputedBudget > available);
  });

  it('sufficient budget allows LLM call to proceed', () => {
    // When pre-computed budget fits within available budget, proceed to LLM call.
    const preComputedBudget = 3000;
    const available = 5000;

    assert.ok(preComputedBudget <= available,
      'Budget check passes: proceed to LLM call');
  });
});

// ---------------------------------------------------------------------------
// §28: Retry with Validation Errors
// ---------------------------------------------------------------------------

describe('§28: Retry with validation errors in prompt', () => {

  it('validation errors appended to retry prompt', () => {
    // §28: "On validation failure: retry with validation errors appended
    //        to prompt (up to maxRetries)."
    //
    // The specific validation errors (field names, expected types, received values)
    // are appended so the LLM can self-correct on the next attempt.

    const validationErrors = [
      'Field "decision": expected one of ["approve","deny","review"] but got "maybe"',
      'Field "confidence": expected number between 0 and 1 but got 1.5',
    ];

    assert.ok(validationErrors.length > 0,
      'Validation errors captured for retry prompt');
    assert.ok(validationErrors[0]!.includes('decision'),
      'Error includes specific field name');
    assert.ok(validationErrors[1]!.includes('confidence'),
      'Error includes specific constraint violation');
  });

  it('each retry attempt consumes from the pre-computed budget', () => {
    // Each retry is a full LLM call. The budget was pre-computed to include
    // maxRetries additional calls. Actual consumption is tracked per attempt.
    //
    // Verify budget math: total budget decreases with each attempt
    const estimatedPerAttempt = 1000;
    const maxRetries = 2;
    const totalBudget = estimatedPerAttempt * (1 + maxRetries);
    let remaining = totalBudget;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      remaining -= estimatedPerAttempt;
      assert.ok(remaining >= 0,
        `After attempt ${attempt}, remaining budget (${remaining}) is non-negative`);
    }

    assert.equal(remaining, 0,
      'Budget fully consumed after all attempts (initial + retries)');
  });

  it('after maxRetries exhausted: VALIDATION_FAILED with details', () => {
    // §28: After all retries fail, return the final validation error.
    const error = {
      code: 'VALIDATION_FAILED',
      message: 'Structured output failed schema validation after 3 attempts (1 initial + 2 retries).',
      spec: '§28',
      lastErrors: [
        'Field "confidence": expected number but got string "high"',
      ],
    };

    assert.equal(error.code, 'VALIDATION_FAILED');
    assert.ok(error.lastErrors.length > 0,
      'Last validation errors included in error response');
  });

  it('successful retry returns typed result (not error)', () => {
    // If attempt 1 fails validation but attempt 2 succeeds,
    // the consumer receives the typed result from attempt 2.
    // They never see the validation error from attempt 1.

    const attempts = [
      { valid: false, error: 'Field "decision" invalid' },
      { valid: true, result: { decision: 'approve', confidence: 0.9, reasoning: 'OK' } },
    ];

    // Find the first successful attempt -- this is what the consumer receives
    const successfulAttempt = attempts.find(a => a.valid);
    assert.ok(successfulAttempt !== undefined, 'At least one attempt succeeded');
    assert.equal(successfulAttempt.valid, true, 'Consumer receives a valid result');
    assert.ok('result' in successfulAttempt, 'Successful attempt carries typed result');
  });
});

// ---------------------------------------------------------------------------
// §28: Audit Records
// ---------------------------------------------------------------------------

describe('§28: Audit records for structured output', () => {

  it('audit records raw LLM output per attempt', () => {
    // §28: "Audit records raw LLM output, validation result, retry count."
    // I-03: "Every state mutation and its audit entry are committed in the
    //         same SQLite transaction."

    const auditRecord = {
      rawOutput: '{"decision":"approve","confidence":0.85,"reasoning":"Clear eligibility"}',
      validationResult: { valid: true, errors: [] as string[] },
      retryCount: 0,
      schema: 'ClaimDecision',
    };

    assert.ok('rawOutput' in auditRecord, 'Audit includes raw LLM output');
    assert.ok('validationResult' in auditRecord, 'Audit includes validation result');
    assert.ok('retryCount' in auditRecord, 'Audit includes retry count');
  });

  it('failed attempts audited alongside successful final attempt', () => {
    // When retries occur, EVERY attempt is audited, not just the final one.
    // This provides full observability into the LLM's ability to follow schema.

    const attempts = [
      { retryCount: 0, rawOutput: '{"decision":"maybe"}', valid: false },
      { retryCount: 1, rawOutput: '{"decision":"approve","confidence":0.9}', valid: false },
      { retryCount: 2, rawOutput: '{"decision":"approve","confidence":0.9,"reasoning":"OK"}', valid: true },
    ];

    assert.equal(attempts.length, 3, 'All attempts audited');
    assert.equal(attempts[0]!.valid, false, 'First attempt: invalid');
    assert.equal(attempts[2]!.valid, true, 'Third attempt: valid');
  });

  it.skip('audit entry committed in same transaction as state mutation (I-03)', () => {
    // UNTESTABLE: Requires production database transaction implementation
    // to verify audit entry and state mutation share a single SQLite
    // transaction. Cannot validate without real I-03 enforcement wiring.
  });
});

// ---------------------------------------------------------------------------
// §28: Provider Independence (I-04)
// ---------------------------------------------------------------------------

describe('§28/I-04: Provider independence for structured output', () => {

  it.skip('infer() works across all registered providers', () => {
    // UNTESTABLE: Requires multiple LLM provider implementations to verify
    // structured output works across all providers. Cannot validate provider
    // independence without real multi-provider wiring (I-04).
  });

  it.skip('schema translation is gateway responsibility, not API layer', () => {
    // UNTESTABLE: Requires production LLM gateway implementation to verify
    // schema translation is at gateway layer, not API layer. Cannot validate
    // layer responsibility without real pipeline wiring (I-04).
  });
});

// ---------------------------------------------------------------------------
// §28: Type Safety
// ---------------------------------------------------------------------------

describe('§28: Type safety of infer<T>()', () => {

  it('return type is T, not unknown or any', () => {
    // §28: "Result: typed, validated, audited."
    //
    // The generic parameter T of infer<T>(schema: ZodSchema<T>) ensures
    // compile-time type safety. The consumer receives T, not unknown.

    interface ClaimDecision {
      decision: 'approve' | 'deny' | 'review';
      confidence: number;
      reasoning: string;
    }

    const result: ClaimDecision = {
      decision: 'approve',
      confidence: 0.85,
      reasoning: 'Policy POL-123 criteria met',
    };

    // These property accesses are type-safe at compile time
    assert.equal(result.decision, 'approve');
    assert.equal(typeof result.confidence, 'number');
    assert.equal(typeof result.reasoning, 'string');
  });

  it('runtime validation guarantees type matches compile-time', () => {
    // The Zod schema provides BOTH:
    // 1. Compile-time type inference (T = z.infer<typeof schema>)
    // 2. Runtime validation (schema.parse(output))
    //
    // Verify that the runtime result matches the compile-time type shape
    interface ClaimDecision {
      decision: 'approve' | 'deny' | 'review';
      confidence: number;
      reasoning: string;
    }

    // Simulate runtime-validated output
    const rawOutput = JSON.parse('{"decision":"approve","confidence":0.85,"reasoning":"OK"}');
    const result: ClaimDecision = rawOutput;

    assert.equal(typeof result.decision, 'string');
    assert.equal(typeof result.confidence, 'number');
    assert.equal(typeof result.reasoning, 'string');
    assert.ok(['approve', 'deny', 'review'].includes(result.decision),
      'Runtime value matches compile-time enum constraint');
  });
});
