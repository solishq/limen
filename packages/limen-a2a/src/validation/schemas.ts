/**
 * A2A perimeter validation schemas.
 *
 * Validates STRUCTURE at the trust boundary. Does NOT duplicate Limen's
 * SEMANTIC validation (FK existence, state machine validity, format rules).
 * Structure at perimeter, semantics in engine.
 *
 * All schemas use .strict() to reject unknown keys at the external boundary.
 */

import { z } from 'zod';

// ── A2A Envelope Schemas ──

export const A2APartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
}).strict();

export const A2AMessageSchema = z.object({
  role: z.enum(['user', 'agent']),
  parts: z.array(A2APartSchema),
}).strict();

export const A2ATaskSendParamsSchema = z.object({
  id: z.string().min(1).optional(),
  message: A2AMessageSchema,
  metadata: z.object({
    skill: z.string().optional(),
    action: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  }).strict().optional(),
}).strict();

// ── Claim Schemas ──

const EvidenceRefSchema = z.object({
  type: z.enum(['memory', 'artifact', 'claim', 'capability_result']),
  id: z.string(),
}).strict();

const RuntimeWitnessInputSchema = z.object({
  witnessType: z.string(),
  witnessedValues: z.record(z.string(), z.unknown()),
  witnessTimestamp: z.string(),
}).strict();

const ClaimIdempotencyInputSchema = z.object({
  key: z.string(),
}).strict();

export const ClaimCreateInputSchema = z.object({
  subject: z.string(),
  predicate: z.string(),
  object: z.object({
    type: z.enum(['string', 'number', 'boolean', 'date', 'json']),
    value: z.unknown(),
  }).strict(),
  confidence: z.number().min(0).max(1),
  validAt: z.string(),
  missionId: z.string(),
  taskId: z.string().nullable(),
  evidenceRefs: z.array(EvidenceRefSchema),
  groundingMode: z.enum(['evidence_path', 'runtime_witness']),
  runtimeWitness: RuntimeWitnessInputSchema.optional(),
  idempotencyKey: ClaimIdempotencyInputSchema.optional(),
}).strict();

export const ClaimQueryInputSchema = z.object({
  subject: z.string().nullable().optional(),
  predicate: z.string().nullable().optional(),
  status: z.enum(['active', 'retracted']).nullable().optional(),
  minConfidence: z.number().nullable().optional(),
  sourceAgentId: z.string().nullable().optional(),
  sourceMissionId: z.string().nullable().optional(),
  validAtFrom: z.string().nullable().optional(),
  validAtTo: z.string().nullable().optional(),
  archiveMode: z.enum(['exclude', 'include', 'only']).optional(),
  includeEvidence: z.boolean().optional(),
  includeRelationships: z.boolean().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
}).strict();

// ── Working Memory Schemas ──

export const WriteWorkingMemoryInputSchema = z.object({
  taskId: z.string(),
  key: z.string().min(1).max(256),
  value: z.string(),
}).strict();

export const ReadWorkingMemoryInputSchema = z.object({
  taskId: z.string(),
  key: z.string().nullable(),
}).strict();

export const DiscardWorkingMemoryInputSchema = z.object({
  taskId: z.string(),
  key: z.string().nullable(),
}).strict();

// ── Mission Schemas ──

export const MissionCreateOptionsSchema = z.object({
  agent: z.string(),
  objective: z.string(),
  successCriteria: z.array(z.string()).optional(),
  scopeBoundaries: z.array(z.string()).optional(),
  constraints: z.object({
    tokenBudget: z.number(),
    deadline: z.string(),
    capabilities: z.array(z.string()).optional(),
    maxTasks: z.number().optional(),
    maxChildren: z.number().optional(),
    maxDepth: z.number().optional(),
  }).strict(),
  deliverables: z.array(z.object({
    type: z.string(),
    name: z.string(),
  }).strict()).optional(),
  parentMissionId: z.string().optional(),
  contractId: z.string().optional(),
}).strict();

export const MissionFilterSchema = z.object({
  state: z.enum([
    'CREATED', 'PLANNING', 'EXECUTING', 'REVIEWING',
    'COMPLETED', 'PAUSED', 'FAILED', 'CANCELLED',
    'DEGRADED', 'BLOCKED',
  ]).optional(),
  agentName: z.string().optional(),
  parentId: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
}).strict();

// ── Agent Management Schemas ──

export const AgentRegisterSchema = z.object({
  name: z.string().min(1),
  domains: z.array(z.string()).optional(),
}).strict();

export const AgentGetSchema = z.object({
  name: z.string().min(1),
}).strict();

export const AgentPromoteSchema = z.object({
  name: z.string().min(1),
}).strict();

// ── Error Formatting ──

export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map(i => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
}
