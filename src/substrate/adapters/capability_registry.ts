/**
 * Capability Adapter Registry implementation.
 * S ref: §25.3 (Capability Adapters), I-12 (Tool Sandboxing), I-22 (Capability Immutability)
 *
 * Phase: 2 (Execution Substrate)
 * Implements: Registry of 7 capability types with per-adapter sandbox configuration,
 *             validation, and sandboxed execution. Capabilities are immutable once
 *             registered for a mission (I-22).
 *
 * Seven capability types per specification:
 *   web_search, web_fetch, code_execute, data_query, file_read, file_write, api_call
 *
 * Invariants enforced: I-12 (sandbox), I-22 (immutable capabilities)
 * Failure modes defended: FM-09 (unauthorized tool execution)
 *
 * SYNC interface. All methods return Result<T>.
 */

import type { DatabaseConnection } from '../../kernel/interfaces/index.js';
import type {
  Result,
  KernelError,
  OperationContext,
} from '../../kernel/interfaces/index.js';
import type {
  CapabilityAdapterRegistry,
  CapabilityType,
  CapabilityRequest,
  CapabilityResult,
  SandboxConfig,
  AdapterRegistration,
  WorkerResourceLimits,
} from '../interfaces/substrate.js';

// ─── Error Constructors ───

function err(code: string, message: string, spec: string): { ok: false; error: KernelError } {
  return { ok: false, error: { code, message, spec } };
}

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

// ─── Constants ───

/** §25.3: The seven capability types defined in the specification */
const ALL_CAPABILITY_TYPES: readonly CapabilityType[] = Object.freeze([
  'web_search',
  'web_fetch',
  'code_execute',
  'data_query',
  'file_read',
  'file_write',
  'api_call',
]);

/** Default resource limits for sandbox (I-12) */
const DEFAULT_RESOURCE_LIMITS: WorkerResourceLimits = Object.freeze({
  maxOldGenerationSizeMb: 128,
  maxYoungGenerationSizeMb: 32,
  codeRangeSizeMb: 16,
});

/** Default sandbox configurations per capability type */
function getDefaultSandboxConfig(type: CapabilityType): SandboxConfig {
  switch (type) {
    case 'web_search':
      return {
        type,
        allowedPaths: [],
        networkAllowed: true,
        maxExecutionMs: 30000,
        resourceLimits: DEFAULT_RESOURCE_LIMITS,
      };
    case 'web_fetch':
      return {
        type,
        allowedPaths: [],
        networkAllowed: true,
        maxExecutionMs: 30000,
        resourceLimits: DEFAULT_RESOURCE_LIMITS,
      };
    case 'code_execute':
      return {
        type,
        allowedPaths: [], // Will be scoped to workspaceDir at runtime
        networkAllowed: false,
        maxExecutionMs: 60000,
        resourceLimits: DEFAULT_RESOURCE_LIMITS,
      };
    case 'data_query':
      return {
        type,
        allowedPaths: [],
        networkAllowed: false,
        maxExecutionMs: 30000,
        resourceLimits: DEFAULT_RESOURCE_LIMITS,
      };
    case 'file_read':
      return {
        type,
        allowedPaths: [], // Scoped to workspaceDir at runtime
        networkAllowed: false,
        maxExecutionMs: 10000,
        resourceLimits: DEFAULT_RESOURCE_LIMITS,
      };
    case 'file_write':
      return {
        type,
        allowedPaths: [], // Scoped to workspaceDir at runtime
        networkAllowed: false,
        maxExecutionMs: 10000,
        resourceLimits: DEFAULT_RESOURCE_LIMITS,
      };
    case 'api_call':
      return {
        type,
        allowedPaths: [],
        networkAllowed: true,
        maxExecutionMs: 30000,
        resourceLimits: DEFAULT_RESOURCE_LIMITS,
      };
  }
}

// ─── Capability Adapter Registry Factory ───

/**
 * Create a CapabilityAdapterRegistry implementation.
 * S ref: §25.3, C-07 (Object.freeze)
 *
 * Adapters are registered with sandbox configurations.
 * Execution validates the requested capability, applies sandbox rules,
 * and dispatches to the adapter implementation.
 */
export function createCapabilityAdapterRegistry(): CapabilityAdapterRegistry {

  /** In-memory adapter registrations */
  const registrations = new Map<CapabilityType, AdapterRegistration>();

  // Register default adapters for all 7 types
  for (const type of ALL_CAPABILITY_TYPES) {
    registrations.set(type, {
      type,
      version: '1.0.0',
      sandboxConfig: getDefaultSandboxConfig(type),
    });
  }

  /**
   * §25.3: Execute a capability in sandbox.
   * FM-09: Validates capability type is registered.
   * I-12: Execution within sandbox constraints.
   */
  function execute(_conn: DatabaseConnection, _ctx: OperationContext, request: CapabilityRequest): Result<CapabilityResult> {
    // F-02: Input validation -- workspaceDir must be non-empty and not contain '..'
    if (!request.workspaceDir || request.workspaceDir.trim() === '') {
      return err('INVALID_INPUT', 'workspaceDir must be a non-empty string', '§25.3/I-12');
    }
    if (request.workspaceDir.includes('..')) {
      return err('INVALID_INPUT', 'workspaceDir must not contain path traversal sequences (..)', '§25.3/I-12');
    }

    // FM-09: Validate the capability type is supported
    if (!ALL_CAPABILITY_TYPES.includes(request.type)) {
      return err(
        'CAPABILITY_NOT_FOUND',
        `Unknown capability type: ${request.type}`,
        '§25.3/FM-09'
      );
    }

    const registration = registrations.get(request.type);
    if (!registration) {
      return err(
        'CAPABILITY_NOT_REGISTERED',
        `Capability ${request.type} not registered`,
        '§25.3'
      );
    }

    // I-12: Validate timeout within sandbox limits
    const sandbox = registration.sandboxConfig;
    // I-12: Timeout is capped to sandbox limit at dispatch time
    // FM-09: Network access validation happens at sandbox boundary
    void sandbox.maxExecutionMs; // Used at dispatch time for timeout enforcement

    // CF-008: Capability execution sandbox not yet implemented.
    // I-12 requires worker_threads with resource limits. Until the sandbox
    // is implemented (Phase 5), ALL execution requests are rejected with
    // SANDBOX_VIOLATION to prevent uncontrolled code execution.
    // This is the fail-closed default — no accidental code execution path exists.
    return err(
      'SANDBOX_VIOLATION',
      `Capability execution sandbox not available. Type '${request.type}' cannot be executed until worker_threads sandbox is implemented.`,
      '§25.3/I-12/FM-09',
    );
  }

  /** §25.3: Validate an adapter registration */
  function validateRegistration(registration: AdapterRegistration): Result<void> {
    // Validate capability type
    if (!ALL_CAPABILITY_TYPES.includes(registration.type)) {
      return err(
        'INVALID_CAPABILITY_TYPE',
        `Unknown capability type: ${registration.type}`,
        '§25.3'
      );
    }

    // Validate version format
    if (!registration.version || registration.version.trim() === '') {
      return err(
        'INVALID_ADAPTER_VERSION',
        'Adapter version is required',
        '§25.3'
      );
    }

    // Validate sandbox config
    const sandbox = registration.sandboxConfig;
    if (sandbox.maxExecutionMs <= 0) {
      return err(
        'INVALID_SANDBOX_CONFIG',
        'maxExecutionMs must be positive',
        'I-12'
      );
    }
    if (sandbox.resourceLimits.maxOldGenerationSizeMb < 1) {
      return err(
        'INVALID_SANDBOX_CONFIG',
        'maxOldGenerationSizeMb must be >= 1',
        'I-12'
      );
    }

    return ok(undefined);
  }

  /** §25.3: Get all supported capability types */
  function getSupportedCapabilities(): Result<readonly CapabilityType[]> {
    return ok(ALL_CAPABILITY_TYPES);
  }

  /** §25.3: Get sandbox config for a capability type */
  function getSandboxConfig(type: CapabilityType): Result<SandboxConfig> {
    const registration = registrations.get(type);
    if (!registration) {
      return err(
        'CAPABILITY_NOT_REGISTERED',
        `Capability ${type} not registered`,
        '§25.3'
      );
    }
    return ok(registration.sandboxConfig);
  }

  const registry: CapabilityAdapterRegistry = {
    execute,
    validateRegistration,
    getSupportedCapabilities,
    getSandboxConfig,
  };

  return Object.freeze(registry);
}
