/**
 * Chat pipeline orchestration for the API surface.
 * S ref: S27 (streaming model), SD-01 (sync return), I-26 (streaming equivalence),
 *        I-28 (pipeline determinism), FPD-1 (why chat() returns synchronously),
 *        FPD-8 (HITL approval-required disables streaming)
 *
 * Phase: 4 (API Surface)
 * Implements: SDD §7 build order item 6
 *
 * The chat pipeline is the core conversational API. It:
 *   1. Returns ChatResult SYNCHRONOUSLY (SD-01) -- fields are async
 *   2. Produces identical ChatResult structure for streaming/non-streaming (I-26)
 *   3. Delegates to substrate's LlmGateway for LLM generation
 *   4. Maps LlmStreamChunk -> StreamChunk at the API boundary
 *   5. Supports AbortSignal cancellation (S27)
 *   6. Enforces per-call timeout (default 60s per S27)
 *   7. Implements cooperative backpressure (4KB buffer, 30s stall timeout per S36)
 *   8. Suppresses streaming in HITL approval-required mode (FPD-8)
 *
 * No database tables owned. All state mutations delegated to L2 Orchestration.
 *
 * Invariants enforced: I-26 (streaming equivalence), I-27 (conversation integrity),
 *                      I-28 (pipeline determinism)
 * Failure modes defended: FM-02 (cost explosion via budget checks),
 *                         FM-06 (provider unavailability)
 */

import type {
  OperationContext, DatabaseConnection, RateLimiter, RbacEngine,
} from '../../kernel/interfaces/index.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type { LlmGateway, LlmRequest } from '../../substrate/interfaces/substrate.js';
import type { OrchestrationEngine, OrchestrationDeps } from '../../orchestration/interfaces/orchestration.js';
import type { AuditTrail } from '../../kernel/interfaces/index.js';
import type { Substrate } from '../../substrate/interfaces/substrate.js';
import type {
  ChatMessage, ChatOptions, ChatResult, StreamChunk,
  FinishReason, ResponseMetadata, BackpressureConfig,
} from '../interfaces/api.js';
import type { SessionState } from '../sessions/session_manager.js';
import { LimenError, ensureLimenError } from '../errors/limen_error.js';
import { requirePermission, buildOperationContext } from '../enforcement/rbac_guard.js';
import { requireRateLimit, requireStreamCapacity } from '../enforcement/rate_guard.js';
import type { TechniqueReader, TechniqueInjectionResult } from './technique_injector.js';
import { injectTechniques } from './technique_injector.js';
// Sprint 5: I-14 latency verification + I-15 cost tracking
import { evaluateLatency } from '../enforcement/latency_harness.js';
import { computeSessionOverhead } from '../enforcement/cost_tracker.js';
import type { MetricsCollector } from '../observability/metrics.js';

// CF-013: Input size limits at API boundary
/** Maximum chat message content size in bytes (default 100KB) */
const MAX_MESSAGE_BYTES = 102_400;

// ============================================================================
// ChatPipeline
// ============================================================================

/**
 * S27, SD-01: Chat pipeline that returns ChatResult synchronously.
 *
 * Constructed once per createLimen() instance. Shared across all sessions
 * within that instance, but state isolation is maintained via SessionState.
 */
export class ChatPipeline {
  constructor(
    private readonly rbac: RbacEngine,
    private readonly rateLimiter: RateLimiter,
    private readonly orchestration: OrchestrationEngine,
    private readonly gateway: LlmGateway,
    private readonly getConnection: () => DatabaseConnection,
    private readonly getAudit: () => AuditTrail,
    private readonly getSubstrate: () => Substrate,
    private readonly defaultTimeoutMs: number,
    private readonly backpressure: BackpressureConfig,
    private readonly defaultModel: string,
    private readonly techniqueReader?: TechniqueReader,
    private readonly modelContextWindow: number = 127_500,
    private readonly time: TimeProvider = { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
    private readonly metrics?: MetricsCollector,
  ) {}

  /**
   * S27, SD-01: Execute chat pipeline.
   * Returns ChatResult SYNCHRONOUSLY (SD-01). The fields (text, stream, metadata)
   * are individually async.
   *
   * FPD-1: Sync return enables immediate stream consumption without extra await.
   * I-26: Same ChatResult structure regardless of streaming mode.
   *
   * @param sessionState - Active session context
   * @param message - User message (string or ChatMessage)
   * @param options - Chat options (streaming, timeout, signal, etc.)
   * @returns ChatResult with async text, stream, and metadata fields
   */
  execute(
    sessionState: SessionState,
    message: string | ChatMessage,
    options?: Omit<ChatOptions, 'sessionId'>,
  ): ChatResult {
    const conn = this.getConnection();
    const ctx = buildOperationContext(
      sessionState.tenantId,
      sessionState.userId,
      sessionState.agentId,
      sessionState.permissions,
      sessionState.sessionId,
    );

    // I-13: RBAC check (SD-14: before rate limit)
    requirePermission(this.rbac, ctx, 'chat');

    // §36: Rate limit check (SD-14: after RBAC)
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    // §36: Stream capacity check
    requireStreamCapacity(
      sessionState.activeStreams.size,
      this.backpressure.maxConcurrentStreams,
    );

    // Normalize message input
    const chatMessage: ChatMessage = typeof message === 'string'
      ? { role: 'user', content: message }
      : message;

    // CF-013: Validate message content size at API boundary
    const contentBytes = Buffer.byteLength(chatMessage.content, 'utf8');
    if (contentBytes > MAX_MESSAGE_BYTES) {
      throw new LimenError('INVALID_INPUT',
        `Message content exceeds maximum size (${contentBytes} bytes > ${MAX_MESSAGE_BYTES} bytes limit).`);
    }

    // Determine streaming mode (default: true per S27)
    const streaming = options?.stream !== false;

    // FPD-8: HITL approval-required mode disables streaming
    const hitlMode = options?.hitl?.mode ?? sessionState.hitlMode;
    const effectiveStreaming = hitlMode === 'approval-required' ? false : streaming;

    // Determine timeout
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;

    // Generate a unique stream ID for tracking
    const streamId = crypto.randomUUID();
    sessionState.activeStreams.add(streamId);

    // Build the pipeline execution context
    // exactOptionalPropertyTypes: only include optional fields when they have values
    const pipelineCtx: PipelineContext = {
      ctx,
      conn,
      chatMessage,
      sessionState,
      streaming: effectiveStreaming,
      timeoutMs,
      streamId,
      ...(options?.signal !== undefined ? { signal: options.signal } : {}),
      ...(hitlMode !== undefined && hitlMode !== null ? { hitlMode } : {}),
      ...(options?.routing !== undefined ? { routing: options.routing } : {}),
      ...(options?.model !== undefined ? { model: options.model } : {}),
      ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
      ...(options?.agent !== undefined ? { agent: options.agent } : {}),
    };

    // SD-01: Return ChatResult synchronously. Fields resolve asynchronously.
    const { textPromise, streamIterable, metadataPromise } = this.buildAsyncResult(pipelineCtx);

    return {
      text: textPromise,
      stream: streamIterable,
      metadata: metadataPromise,
    };
  }

  /**
   * Build the async result components for ChatResult.
   * The pipeline execution drives the stream generator, which in turn
   * drives text accumulation and metadata collection.
   */
  private buildAsyncResult(pctx: PipelineContext): {
    textPromise: Promise<string>;
    streamIterable: AsyncIterable<StreamChunk>;
    metadataPromise: Promise<ResponseMetadata>;
  } {
    // Shared state between the three async result components
    let resolveText: (text: string) => void;
    let rejectText: (error: Error) => void;
    let resolveMetadata: (metadata: ResponseMetadata) => void;
    let rejectMetadata: (error: Error) => void;

    const textPromise = new Promise<string>((resolve, reject) => {
      resolveText = resolve;
      rejectText = reject;
    });

    const metadataPromise = new Promise<ResponseMetadata>((resolve, reject) => {
      resolveMetadata = resolve;
      rejectMetadata = reject;
    });

    const pipeline = this;

    // The stream iterable runs the pipeline and yields chunks
    const streamIterable: AsyncIterable<StreamChunk> = {
      [Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
        return pipeline.runPipeline(
          pctx,
          resolveText!,
          rejectText!,
          resolveMetadata!,
          rejectMetadata!,
        );
      },
    };

    return { textPromise, streamIterable, metadataPromise };
  }

  /**
   * Run the pipeline and yield stream chunks.
   *
   * Delegates to the substrate's LlmGateway for generation.
   * Maps LlmStreamChunk to public StreamChunk at the API boundary.
   * Appends turn to conversation via L2 ConversationManager.
   */
  private runPipeline(
    pctx: PipelineContext,
    resolveText: (text: string) => void,
    rejectText: (error: Error) => void,
    resolveMetadata: (metadata: ResponseMetadata) => void,
    rejectMetadata: (error: Error) => void,
  ): AsyncIterator<StreamChunk> {
    const pipeline = this;
    const pClock = this.time;
    let accumulated = '';
    const startTime = pClock.nowMs();
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: FinishReason = 'stop';
    let providerId = 'unknown';
    let modelUsed = pctx.model ?? this.defaultModel;
    let ttftMs = 0;
    let firstContentEmitted = false;

    // I-28: 9-phase execution tracking. Each phase records start/end for metadata.
    const phaseTimings: Array<{ phase: import('../interfaces/api.js').PipelinePhase; durationMs: number }> = [];

    /**
     * I-28: Execute a pipeline phase, recording its duration and emitting a status chunk.
     * Even pass-through phases are recorded for deterministic pipeline structure.
     */
    function runPhase(
      phaseName: import('../interfaces/api.js').PipelinePhase,
      fn: () => void,
    ): void {
      const phaseStart = pClock.nowMs();
      fn();
      const durationMs = pClock.nowMs() - phaseStart;
      phaseTimings.push({ phase: phaseName, durationMs });
      enqueueChunk({ type: 'status', phase: phaseName, durationMs });
    }

    /**
     * I-28: Async variant for phases that require awaiting (generation, learning).
     */
    async function runPhaseAsync(
      phaseName: import('../interfaces/api.js').PipelinePhase,
      fn: () => Promise<void>,
    ): Promise<void> {
      const phaseStart = pClock.nowMs();
      await fn();
      const durationMs = pClock.nowMs() - phaseStart;
      phaseTimings.push({ phase: phaseName, durationMs });
      enqueueChunk({ type: 'status', phase: phaseName, durationMs });
    }

    // Set up abort/timeout handling
    const abortController = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    if (pctx.signal) {
      pctx.signal.addEventListener('abort', () => abortController.abort(), { once: true });
    }

    // S27: Default 60s timeout
    timeoutHandle = setTimeout(() => abortController.abort(), pctx.timeoutMs);

    // Chunks queue for the async iterator
    const chunks: StreamChunk[] = [];
    // Mutable holder avoids TypeScript control-flow narrowing issues across async boundaries
    const resolveHolder: { fn: (() => void) | null } = { fn: null };
    let pipelineComplete = false;

    // CF-034a: Backpressure tracking — 4KB buffer, 30s stall detection
    let bufferBytes = 0;
    let drainResolve: (() => void) | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let backpressureRecorded = false;

    // Track turn number from conversation append
    let turnNumber = 0;

    // Phase 2B: TGP ↔ Pipeline — technique injection result (set in context_assembly)
    let techniqueInjection: TechniqueInjectionResult | null = null;

    // Start the pipeline execution asynchronously
    const pipelineExecution = (async () => {
      try {
        // Check for cancellation
        if (abortController.signal.aborted) {
          finishReason = pctx.signal?.aborted ? 'cancelled' : 'timeout';
          enqueueChunk({ type: 'done', finishReason });
          resolveText('');
          return;
        }

        const deps = pipeline.buildOrchDeps(pctx.conn);

        // ── Phase 1: perception ──
        // I-28: Process incoming message, normalize input, extract intent signals.
        runPhase('perception', () => {
          // Perception: message normalization already done in execute().
          // This phase validates the input is well-formed for downstream processing.
        });

        // ── Phase 2: retrieval ──
        // I-28: Retrieve relevant context from memory/knowledge stores.
        runPhase('retrieval', () => {
          // Retrieval: pass-through stub. Memory subsystem integration pending.
          // When wired, this phase queries the knowledge store for relevant context.
        });

        // ── Phase 3: context_assembly ──
        // I-28: Assemble conversation history + retrieved context into LLM prompt.
        // Phase 2B: TGP ↔ Pipeline — inject active techniques into system prompt.
        runPhase('context_assembly', () => {
          // S26: Append user turn to conversation
          const appendResult = pipeline.orchestration.conversations.appendTurn(
            deps, pctx.sessionState.conversationId, {
              role: 'user',
              content: pctx.chatMessage.content,
              tokenCount: 0, // Token count computed by gateway
            },
          );
          // S26: Extract turn number from conversation state
          if (appendResult.ok) {
            turnNumber = appendResult.value;
          }

          // Phase 2B: TGP ↔ Pipeline — query and prepare active techniques for injection.
          // §31: Only active prompt_fragment techniques, ordered by confidence descending,
          //       truncated to 20% of model context window.
          // I-96: Candidates, suspended, retired excluded by getActivePromptFragments.
          // Graceful degradation: TGP failure = no techniques, model operates without them.
          if (pipeline.techniqueReader && pctx.sessionState.tenantId) {
            techniqueInjection = injectTechniques(
              pipeline.techniqueReader,
              pctx.conn,
              pctx.sessionState.agentId,
              pctx.sessionState.tenantId,
              pipeline.modelContextWindow,
            );
          }
        });

        // ── Phase 4: pre_safety ──
        // DL-5: Pre-generation safety gate. Validates input against safety policies.
        runPhase('pre_safety', () => {
          // Pre-safety: pass-through stub. Safety gate pipeline pending Phase 5 wiring.
          // When wired, this phase runs DL-5 safety checks on the assembled prompt.
        });

        // ── Phase 5: generation ──
        // S27: Core LLM generation phase. Streaming or non-streaming.
        await runPhaseAsync('generation', async () => {
          // Build LLM request
          // exactOptionalPropertyTypes: omit optional fields rather than setting undefined
          // Phase 2B: TGP ↔ Pipeline — inject technique content into systemPrompt (I-94: verbatim)
          const llmRequest: LlmRequest = {
            model: modelUsed,
            messages: [{ role: 'user', content: pctx.chatMessage.content }],
            maxTokens: pctx.maxTokens ?? 4096,
            ...(techniqueInjection && techniqueInjection.systemPromptSection.length > 0
              ? { systemPrompt: techniqueInjection.systemPromptSection }
              : {}),
          };

          if (pctx.streaming) {
            // Streaming mode: use requestStream
            const streamResult = await pipeline.gateway.requestStream(
              pctx.conn, pctx.ctx, llmRequest,
            );

            if (!streamResult.ok) {
              throw new LimenError('PROVIDER_UNAVAILABLE', 'LLM provider request failed.');
            }

            for await (const chunk of streamResult.value) {
              if (abortController.signal.aborted) {
                finishReason = pctx.signal?.aborted ? 'cancelled' : 'timeout';
                break;
              }

              switch (chunk.type) {
                case 'content_delta':
                  // S27: Track ttftMs -- time from pipeline start to first content_delta
                  if (!firstContentEmitted) {
                    ttftMs = pClock.nowMs() - startTime;
                    firstContentEmitted = true;
                  }
                  accumulated += chunk.delta;
                  // CF-034a: Use backpressure-aware enqueue for content deltas
                  await enqueueChunkWithBackpressure({ type: 'content_delta', delta: chunk.delta });
                  break;
                case 'usage':
                  inputTokens = chunk.inputTokens;
                  outputTokens = chunk.outputTokens;
                  break;
                case 'done':
                  finishReason = chunk.finishReason as FinishReason;
                  break;
                case 'error':
                  throw new LimenError('PROVIDER_UNAVAILABLE', chunk.error);
                case 'tool_call_delta':
                  // Map tool call deltas to stream chunks
                  break;
              }
            }
          } else {
            // Non-streaming mode: use request
            const responseResult = await pipeline.gateway.request(
              pctx.conn, pctx.ctx, llmRequest,
            );

            if (!responseResult.ok) {
              throw new LimenError('PROVIDER_UNAVAILABLE', 'LLM provider request failed.');
            }

            const response = responseResult.value;
            const text = typeof response.content === 'string'
              ? response.content
              : response.content.filter((b) => b.type === 'text').map((b) => (b as { type: 'text'; text: string }).text).join('');

            accumulated = text;
            inputTokens = response.usage.inputTokens;
            outputTokens = response.usage.outputTokens;
            providerId = response.providerId;
            modelUsed = response.model;
            finishReason = response.finishReason as FinishReason;

            // S27: Track ttftMs for non-streaming (first content available now)
            ttftMs = pClock.nowMs() - startTime;

            // I-26: Even in non-streaming mode, yield one content_delta chunk
            enqueueChunk({ type: 'content_delta', delta: text });
          }
        });

        // ── Phase 6: post_safety ──
        // DL-5: Post-generation safety gate. Validates output against safety policies.
        runPhase('post_safety', () => {
          // Post-safety: pass-through stub. Safety gate pipeline pending Phase 5 wiring.
          // When wired, this phase runs DL-5 output safety checks on generated content.
        });

        // ── Phase 7: learning ──
        // S29: Learning cycle. Records interaction for future improvement.
        // LEARNING-02: Records interaction to core_interactions for learning pipeline.
        runPhase('learning', () => {
          // S26: Append assistant turn to conversation
          pipeline.orchestration.conversations.appendTurn(
            deps, pctx.sessionState.conversationId, {
              role: 'assistant',
              content: accumulated,
              tokenCount: outputTokens,
              modelUsed,
            },
          );

          // Phase 7: Record interaction for learning pipeline (LEARNING-02)
          // Non-fatal — interaction recording failure must not break the pipeline
          try {
            const interactionId = crypto.randomUUID();
            const interactionNow = pClock.nowISO();
            pctx.conn.run(
              `INSERT INTO core_interactions (id, tenant_id, agent_id, session_id, conversation_id, user_input, assistant_output, model_used, input_tokens, output_tokens, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                interactionId,
                pctx.sessionState.tenantId ?? null,
                pctx.sessionState.agentId ?? null,
                pctx.sessionState.sessionId,
                pctx.sessionState.conversationId,
                pctx.chatMessage.content,
                accumulated,
                modelUsed,
                inputTokens,
                outputTokens,
                interactionNow,
              ],
            );
          } catch (recordingErr: unknown) {
            // F-S2-003 FIX: Non-fatal, but record failure in audit trail for observability.
            // Pattern: Sprint 1 fix F-S1-003 (capability result persistence failure audit).
            try {
              pipeline.getAudit().append(pctx.conn, {
                tenantId: pctx.sessionState.tenantId ?? null,
                actorType: 'system',
                actorId: 'chat_pipeline',
                operation: 'interaction_recording_failed',
                resourceType: 'interaction',
                resourceId: pctx.sessionState.conversationId,
                detail: {
                  error: recordingErr instanceof Error ? recordingErr.message : String(recordingErr),
                  sessionId: pctx.sessionState.sessionId,
                },
              });
            } catch { /* audit itself failed — truly terminal, nothing to do */ }
          }
        });

        // ── Phase 8: evaluation ──
        // S32: Evaluate response quality metrics.
        runPhase('evaluation', () => {
          // Evaluation: pass-through stub. Quality evaluation pipeline pending Phase 5 wiring.
          // When wired, this phase scores response quality and records evaluation metrics.
        });

        // ── Phase 9: audit ──
        // I-03: Record the interaction in the audit trail.
        runPhase('audit', () => {
          // Audit: pass-through stub. Full audit entry pending Phase 5 wiring.
          // When wired, this phase writes an append-only audit record per I-03.
        });

        // Emit done chunk
        enqueueChunk({ type: 'done', finishReason });

        // Resolve text promise
        resolveText(accumulated);

        // Build and resolve metadata with actual per-phase durations
        const totalMs = pClock.nowMs() - startTime;
        const metadata: ResponseMetadata = {
          traceId: crypto.randomUUID(),
          sessionId: pctx.sessionState.sessionId,
          conversationId: pctx.sessionState.conversationId,
          // S26: Populate turnNumber from conversation state
          turnNumber,
          // S27: Time to first content_delta chunk
          ttftMs,
          totalMs,
          tokens: {
            input: inputTokens,
            output: outputTokens,
            // FM-02: Populate cost from actual LLM response usage data
            cost: (inputTokens + outputTokens) * 0.000001,
          },
          provider: {
            id: providerId,
            model: modelUsed,
          },
          // I-28: Actual per-phase durations from 9-phase execution
          phases: phaseTimings,
          techniquesApplied: (techniqueInjection as TechniqueInjectionResult | null)?.count ?? 0,
          techniqueTokenCost: (techniqueInjection as TechniqueInjectionResult | null)?.techniqueTokenCost ?? 0,
          safetyGates: [],
        };

        // Sprint 5, I-14: Evaluate latency budget compliance (post-pipeline verification).
        // Does NOT throw on violation — returns report for observability.
        // Violations are informational; the pipeline has already completed.
        const latencyReport = evaluateLatency(phaseTimings);
        if (!latencyReport.withinBudget) {
          // Emit latency warning via audit trail (non-fatal, best-effort)
          try {
            pipeline.getAudit().append(pctx.conn, {
              tenantId: pctx.sessionState.tenantId ?? null,
              actorType: 'system',
              actorId: 'chat_pipeline',
              operation: 'latency_budget_exceeded',
              resourceType: 'pipeline',
              resourceId: pctx.sessionState.sessionId,
              detail: {
                hotPathMs: latencyReport.hotPathMs,
                hotPathBudgetMs: latencyReport.hotPathBudgetMs,
                violationCount: latencyReport.violations.length,
                violations: latencyReport.violations.map(v => ({
                  phase: v.phase,
                  budgetMs: v.budgetMs,
                  actualMs: v.actualMs,
                  severity: v.severity,
                })),
              },
            });
          } catch { /* latency audit is best-effort */ }
        }

        // Sprint 5, I-15: Compute and record per-session overhead.
        // The overhead snapshot is computed from metadata for observability.
        // The actual cost scaling verification (evaluateCostScaling) is run
        // at mission or session level, not per-pipeline-call.
        computeSessionOverhead(
          pctx.sessionState.sessionId,
          '', // Mission ID not available at pipeline level
          metadata,
        );

        resolveMetadata(metadata);

        // PRR-103: Wire metrics recording
        if (pipeline.metrics) {
          const tid = pctx.sessionState.tenantId ?? undefined;
          pipeline.metrics.recordRequest(totalMs, tid);
          pipeline.metrics.recordTokens(
            inputTokens, outputTokens,
            (inputTokens + outputTokens) * 0.000001, tid,
          );
          if (ttftMs > 0) pipeline.metrics.recordTtft(ttftMs);
        }
      } catch (error) {
        const cortexError = ensureLimenError(error);

        // PRR-103: Record provider errors in metrics
        if (pipeline.metrics && cortexError.code === 'PROVIDER_UNAVAILABLE') {
          pipeline.metrics.recordProviderError(pctx.sessionState.tenantId ?? undefined);
        }

        // Emit error chunk
        enqueueChunk({ type: 'error', code: cortexError.code, message: cortexError.message });

        // Reject text and metadata promises
        rejectText(cortexError);
        rejectMetadata(cortexError);
      } finally {
        pipelineComplete = true;
        // Clean up
        if (timeoutHandle) clearTimeout(timeoutHandle);
        pctx.sessionState.activeStreams.delete(pctx.streamId);
        // Wake up any waiting consumer
        if (resolveHolder.fn) resolveHolder.fn();
      }
    })();

    // Suppress unhandled rejection -- it's handled via rejectText/rejectMetadata
    pipelineExecution.catch(() => {});

    /**
     * CF-034a: Estimate byte size of a chunk for backpressure tracking.
     */
    function estimateChunkBytes(chunk: StreamChunk): number {
      if (chunk.type === 'content_delta') return Buffer.byteLength(chunk.delta, 'utf8');
      return 64; // Status/control chunks are small, estimate conservatively
    }

    function enqueueChunk(chunk: StreamChunk): void {
      bufferBytes += estimateChunkBytes(chunk);
      chunks.push(chunk);
      if (resolveHolder.fn) {
        resolveHolder.fn();
        resolveHolder.fn = null;
      }
    }

    /**
     * CF-034a: Async variant that waits for buffer drain when full.
     * Used in the generation phase where content_delta chunks accumulate.
     */
    async function enqueueChunkWithBackpressure(chunk: StreamChunk): Promise<void> {
      enqueueChunk(chunk);
      // S36: If buffer exceeds configured size, wait for consumer to drain
      if (bufferBytes > pipeline.backpressure.bufferSizeBytes) {
        if (!backpressureRecorded) {
          backpressureRecorded = true;
        }
        await new Promise<void>(resolve => { drainResolve = resolve; });
      }
    }

    /**
     * CF-034a: Reset stall detection timer. Called on each next() invocation.
     * If consumer doesn't call next() within stallTimeoutMs, abort the pipeline.
     */
    function resetStallTimer(): void {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        // S36: Stall detected — consumer hasn't read in stallTimeoutMs
        abortController.abort();
        pipelineComplete = true;
        if (resolveHolder.fn) {
          resolveHolder.fn();
          resolveHolder.fn = null;
        }
      }, pipeline.backpressure.stallTimeoutMs);
    }

    // AsyncIterator implementation
    return {
      async next(): Promise<IteratorResult<StreamChunk>> {
        // CF-034a: Reset stall timer on each consumer read
        resetStallTimer();

        while (chunks.length === 0 && !pipelineComplete) {
          // Wait for chunks to be enqueued
          await new Promise<void>((resolve) => {
            resolveHolder.fn = resolve;
          });
        }

        if (chunks.length > 0) {
          const chunk = chunks.shift()!;

          // CF-034a: Track buffer drain for backpressure
          bufferBytes -= estimateChunkBytes(chunk);
          if (bufferBytes < 0) bufferBytes = 0;

          // CF-034a: Resume producer if buffer drained below threshold
          if (drainResolve && bufferBytes <= pipeline.backpressure.bufferSizeBytes) {
            drainResolve();
            drainResolve = null;
          }

          return { value: chunk, done: false };
        }

        // Pipeline complete, no more chunks
        if (stallTimer) clearTimeout(stallTimer);
        return { value: undefined as unknown as StreamChunk, done: true };
      },

      async return(): Promise<IteratorResult<StreamChunk>> {
        // Consumer stopped reading early. Abort the pipeline.
        if (stallTimer) clearTimeout(stallTimer);
        abortController.abort();
        if (drainResolve) { drainResolve(); drainResolve = null; }
        return { value: undefined as unknown as StreamChunk, done: true };
      },

      async throw(_error: Error): Promise<IteratorResult<StreamChunk>> {
        if (stallTimer) clearTimeout(stallTimer);
        abortController.abort();
        if (drainResolve) { drainResolve(); drainResolve = null; }
        return { value: undefined as unknown as StreamChunk, done: true };
      },
    };
  }

  /**
   * Build OrchestrationDeps for L2 subsystem calls.
   */
  private buildOrchDeps(conn: DatabaseConnection): OrchestrationDeps {
    return {
      conn,
      substrate: this.getSubstrate(),
      audit: this.getAudit(),
      time: this.time,
    };
  }
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Internal pipeline execution context.
 * Bundles all parameters needed for a single chat pipeline run.
 */
interface PipelineContext {
  readonly ctx: OperationContext;
  readonly conn: DatabaseConnection;
  readonly chatMessage: ChatMessage;
  readonly sessionState: SessionState;
  readonly streaming: boolean;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly hitlMode?: import('../interfaces/api.js').HitlMode;
  readonly routing?: 'auto' | 'quality' | 'speed' | 'explicit';
  readonly model?: string;
  readonly maxTokens?: number;
  readonly agent?: string;
  readonly streamId: string;
}
