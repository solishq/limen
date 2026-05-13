/*
 * Fail-closed append-only audit chain.
 * Contract refs: SHARED_TYPES.md §10.3; AUDIT_VISUALIZATION_SCHEMA.md §§1-2.1, §7.1; SHARED_TYPES.md §20.
 */

import { createHash } from 'node:crypto';
import {
  adapterError,
  brand,
  ok,
  err,
  type AdapterId,
  type AdapterKernelError,
  type AgentId,
  type AuditLogEntry,
  type ClassificationLevel,
  type EventId,
  type GovernanceAction,
  type GovernanceDecision,
  type Result,
  type SessionId,
  type TenantId,
  type AgentEvent,
} from '../types/index.js';

export interface AuditAppendInput {
  readonly tenantId: TenantId | null;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly event: AgentEvent;
  readonly action: GovernanceAction | null;
  readonly governanceDecision: GovernanceDecision | null;
  readonly details: Readonly<Record<string, unknown>>;
  readonly classification: ClassificationLevel;
}

export interface AuditSink {
  append(entry: AuditLogEntry): Result<void, AdapterKernelError>;
}

export interface AuditLoggerOptions {
  readonly adapterId: AdapterId;
  readonly nowIso: () => string;
  readonly nowMs?: () => number;
  readonly idFactory: () => string;
  readonly sink?: AuditSink;
}

export class InMemoryAuditSink implements AuditSink {
  private readonly entriesInternal: AuditLogEntry[] = [];

  // SHARED_TYPES.md §10.3: append-only entries are retained in insertion order.
  public append(entry: AuditLogEntry): Result<void, AdapterKernelError> {
    this.entriesInternal.push(entry);
    return ok(undefined);
  }

  // AUDIT_VISUALIZATION_SCHEMA.md §1: visualization derives from retained audit entries.
  public entries(): readonly AuditLogEntry[] {
    return this.entriesInternal;
  }
}

export class AuditLogger {
  private previousHash = 'GENESIS';
  private chainPosition = 0;
  private readonly sink: AuditSink;
  private readonly nowMs: () => number;

  public constructor(private readonly options: AuditLoggerOptions) {
    this.sink = options.sink ?? new InMemoryAuditSink();
    this.nowMs = options.nowMs ?? (() => Date.parse(options.nowIso()));
  }

  // SHARED_TYPES.md §10.3 and §20: no success is returned until durable audit append succeeds.
  public append(input: AuditAppendInput): Result<AuditLogEntry, AdapterKernelError> {
    const startedAt = this.nowMs();
    const entryWithoutCurrentHash = {
      id: brand<'EventId'>(this.options.idFactory()),
      timestamp: this.options.nowIso(),
      tenantId: input.tenantId,
      agentId: input.agentId,
      sessionId: input.sessionId,
      event: input.event,
      action: input.action,
      governanceDecision: input.governanceDecision,
      details: {
        ...input.details,
        auditChainPosition: this.chainPosition,
      },
      previousHash: this.previousHash,
      classification: input.classification,
    } satisfies Omit<AuditLogEntry, 'currentHash'>;
    const currentHash = hashAuditEntry(entryWithoutCurrentHash);
    const entry: AuditLogEntry = { ...entryWithoutCurrentHash, currentHash };
    const sinkResult = this.sink.append(entry);
    if (!sinkResult.ok) {
      return err(sinkResult.error);
    }
    const elapsedMs = this.nowMs() - startedAt;
    if (elapsedMs > 50) {
      return err(adapterError(
        this.options.adapterId,
        'PERFORMANCE_BUDGET_EXCEEDED',
        'Audit append exceeded 50ms budget.',
        'SHARED_TYPES.md §20',
        { elapsedMs },
      ));
    }
    this.previousHash = currentHash;
    this.chainPosition += 1;
    return ok(entry);
  }

  // AUDIT_VISUALIZATION_SCHEMA.md §8.1: chain integrity is queryable from audit source of truth.
  public verifyChain(entries: readonly AuditLogEntry[]): Result<void, AdapterKernelError> {
    let previous: string = 'GENESIS';
    for (const entry of entries) {
      const withoutCurrentHash: Omit<AuditLogEntry, 'currentHash'> = {
        id: entry.id,
        timestamp: entry.timestamp,
        tenantId: entry.tenantId,
        agentId: entry.agentId,
        sessionId: entry.sessionId,
        event: entry.event,
        action: entry.action,
        governanceDecision: entry.governanceDecision,
        details: entry.details,
        previousHash: entry.previousHash,
        classification: entry.classification,
      };
      const expected = hashAuditEntry(withoutCurrentHash);
      if (entry.previousHash !== previous || entry.currentHash !== expected) {
        return err(adapterError(
          this.options.adapterId,
          'AUDIT_APPEND_FAILED',
          'Audit hash chain integrity violation.',
          'SHARED_TYPES.md §10.3',
          { entryId: entry.id, expectedPrevious: previous, actualPrevious: entry.previousHash },
        ));
      }
      previous = entry.currentHash;
    }
    return ok(undefined);
  }

  public get lastHash(): string {
    return this.previousHash;
  }
}

export function hashAuditEntry(entry: Omit<AuditLogEntry, 'currentHash'>): string {
  return createHash('sha256').update(canonicalJson(entry)).digest('hex');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(objectValue).sort()) {
      sorted[key] = sortValue(objectValue[key]);
    }
    return sorted;
  }
  return value;
}

export function auditId(entry: AuditLogEntry): EventId {
  return entry.id;
}
