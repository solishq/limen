/**
 * WorkingMemoryApiImpl — Consumer-facing convenience wrapper for WMP system calls.
 *
 * Sprint 7: Bridge to Claude Code
 * Follows AgentApiImpl pattern (src/api/agents/agent_api.ts):
 *   Constructor receives getConnection/getContext closures.
 *   Each method calls them internally before delegating to RawWorkingMemoryFacade.
 *
 * This eliminates the need for consumers to construct DatabaseConnection
 * and OperationContext — internal kernel types they cannot access.
 *
 * Security: RawWorkingMemoryFacade still enforces RBAC + rate limiting (DC-P4-405).
 * Invariants: I-13 (authorization), I-17 (governance boundary).
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { OperationContext, Result } from '../../kernel/interfaces/index.js';
import type {
  WriteWorkingMemoryInput, WriteWorkingMemoryOutput,
  ReadWorkingMemoryInput, ReadWorkingMemoryOutput,
  DiscardWorkingMemoryInput, DiscardWorkingMemoryOutput,
} from '../../working-memory/interfaces/wmp_types.js';
import type { WorkingMemoryApi } from '../interfaces/api.js';
import type { RawWorkingMemoryFacade } from './working_memory_facade.js';

export class WorkingMemoryApiImpl implements WorkingMemoryApi {
  constructor(
    private readonly raw: RawWorkingMemoryFacade,
    private readonly getConnection: () => DatabaseConnection,
    private readonly getContext: () => OperationContext,
  ) {}

  write(input: WriteWorkingMemoryInput): Result<WriteWorkingMemoryOutput> {
    return this.raw.write(this.getConnection(), this.getContext(), input);
  }

  read(input: ReadWorkingMemoryInput): Result<ReadWorkingMemoryOutput> {
    return this.raw.read(this.getConnection(), this.getContext(), input);
  }

  discard(input: DiscardWorkingMemoryInput): Result<DiscardWorkingMemoryOutput> {
    return this.raw.discard(this.getConnection(), this.getContext(), input);
  }
}
