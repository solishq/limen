// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AGENT_OUTPUT_GOVERNANCE.md §7.1-§7.4
/**
 * Plugin Lifecycle Manager — Install, uninstall, list with capability gating.
 *
 * Implements: OG-7.1 through OG-7.20, OG-12.5, OG-12.6, OG-12.9
 */

import { randomUUID } from 'node:crypto';
import type { Result, OperationContext } from '../kernel/interfaces/index.js';
import type { AuditTrail } from '../kernel/interfaces/audit.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type { EventBus } from '../kernel/interfaces/events.js';
import type { DatabaseConnection } from '../kernel/interfaces/database.js';
import type {
  AgentPlugin, PluginConfig, PluginRegistration, PluginContext,
  PluginApi, PluginLogger,
  OutputFilter, OutputEntry, VitalFilter, VitalRecord, CostFilter, CostRecord,
  AgentEvent, AgentEventHandler,
} from './output_types.js';
import {
  PLUGIN_CONFIG_DEFAULTS, PLUGIN_NAME_MAX_LENGTH, SEMVER_REGEX,
} from './output_types.js';

// ── Result Helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message, spec: 'AOG-7' } };
}

// ============================================================================
// Internal Plugin Entry
// ============================================================================

interface PluginEntry {
  readonly pluginId: string;
  readonly plugin: AgentPlugin;
  readonly config: PluginConfig;
  readonly installedAt: string;
  readonly subscriptionIds: string[];
  status: 'active' | 'disabled' | 'error';
  errorCount: number;
  lastError: string | null;
}

// ============================================================================
// Dependencies
// ============================================================================

// BRK-002: PluginQueryDelegate allows real query delegation from parent client
export interface PluginQueryDelegate {
  queryOutputs(filter: OutputFilter): Promise<Result<OutputEntry[]>>;
  queryVitals(filter: VitalFilter): Promise<Result<VitalRecord[]>>;
  queryCosts(filter: CostFilter): Promise<Result<CostRecord[]>>;
}

export interface PluginLifecycleDeps {
  readonly getConnection: () => DatabaseConnection;
  readonly getContext: () => OperationContext;
  readonly audit: AuditTrail;
  readonly time: TimeProvider;
  readonly events: EventBus;
  readonly getAgentCapabilities: () => readonly string[];
  // BRK-002: Delegate for real query operations
  readonly queryDelegate?: PluginQueryDelegate;
}

// ============================================================================
// Interface
// ============================================================================

export interface PluginLifecycleManager {
  install(plugin: AgentPlugin, config?: PluginConfig): Promise<Result<string>>;
  uninstall(pluginId: string): Promise<Result<void>>;
  list(): Result<PluginRegistration[]>;
}

// ============================================================================
// Factory
// ============================================================================

const MAX_PLUGINS = 50;

export function createPluginLifecycleManager(deps: PluginLifecycleDeps): PluginLifecycleManager {
  const { getConnection, getContext, audit, time, events, getAgentCapabilities, queryDelegate } = deps;

  const plugins = new Map<string, PluginEntry>();

  function emitEvent(eventType: string, payload: Record<string, unknown>): void {
    try {
      const conn = getConnection();
      const ctx = getContext();
      events.emit(conn, ctx, {
        type: eventType,
        scope: 'system',
        payload,
        propagation: 'local',
      });
    } catch { /* non-fatal */ }
  }

  function appendAudit(operation: string, resourceType: string, resourceId: string, detail?: Record<string, unknown>): void {
    try {
      const conn = getConnection();
      audit.append(conn, {
        tenantId: null,
        actorType: 'system',
        actorId: 'output-governance',
        operation,
        resourceType,
        resourceId,
        ...(detail !== undefined ? { detail } : {}),
      });
    } catch { /* non-fatal */ }
  }

  async function install(plugin: AgentPlugin, config?: PluginConfig): Promise<Result<string>> {
    // OG-7.2: Validate name
    if (!plugin.name || plugin.name.length === 0 || plugin.name.length > PLUGIN_NAME_MAX_LENGTH) {
      return err('PLUGIN_INSTALL_FAILED', `Plugin name must be 1-${PLUGIN_NAME_MAX_LENGTH} characters`);
    }

    // OG-7.3: Validate semver
    if (!SEMVER_REGEX.test(plugin.version)) {
      return err('PLUGIN_INSTALL_FAILED', `Plugin version must be valid semver: ${plugin.version}`);
    }

    // OG-7.1: Uniqueness
    if (plugins.has(plugin.id)) {
      return err('PLUGIN_INSTALL_FAILED', `Plugin with ID '${plugin.id}' is already installed`);
    }

    if (plugins.size >= MAX_PLUGINS) {
      return err('PLUGIN_INSTALL_FAILED', `Maximum plugins limit (${MAX_PLUGINS}) reached`);
    }

    // OG-7.4: Capability validation
    const agentCapabilities = getAgentCapabilities();
    const missingCapabilities = plugin.capabilities.filter(
      cap => !agentCapabilities.includes(cap)
    );
    if (missingCapabilities.length > 0) {
      return err('PLUGIN_CAPABILITY_DENIED',
        `Plugin requires capabilities [${missingCapabilities.join(', ')}] not available to agent`);
    }

    const resolvedConfig: PluginConfig = { ...PLUGIN_CONFIG_DEFAULTS, ...config };
    const pluginId = plugin.id || randomUUID();
    const now = time.nowISO();
    const subscriptionIds: string[] = [];

    // OG-7.12, OG-7.13: Create logger tagged with plugin ID
    const pluginLogger: PluginLogger = {
      debug(message: string, data?: Record<string, unknown>) {
        emitEvent('plugin:log', { pluginId, level: 'debug', message, data });
      },
      info(message: string, data?: Record<string, unknown>) {
        emitEvent('plugin:log', { pluginId, level: 'info', message, data });
      },
      warn(message: string, data?: Record<string, unknown>) {
        emitEvent('plugin:log', { pluginId, level: 'warn', message, data });
      },
      error(message: string, data?: Record<string, unknown>) {
        emitEvent('plugin:log', { pluginId, level: 'error', message, data });
      },
    };

    // OG-7.10: Read-only API — BRK-002: delegate to real query implementation
    const pluginApi: PluginApi = {
      async queryOutputs(filter: OutputFilter): Promise<Result<OutputEntry[]>> {
        if (queryDelegate) return queryDelegate.queryOutputs(filter);
        return ok([]);
      },
      async queryVitals(filter: VitalFilter): Promise<Result<VitalRecord[]>> {
        if (queryDelegate) return queryDelegate.queryVitals(filter);
        return ok([]);
      },
      async queryCosts(filter: CostFilter): Promise<Result<CostRecord[]>> {
        if (queryDelegate) return queryDelegate.queryCosts(filter);
        return ok([]);
      },
    };

    // BRK-014: Sandboxed plugins get isolated context
    const isSandboxed = resolvedConfig.isolation === 'sandboxed';
    const eventNamespace = isSandboxed ? `plugin:${pluginId}:` : '';

    // BRK-014: Sandboxed API filters results to plugin's own outputs
    const sandboxedApi: PluginApi = isSandboxed ? {
      async queryOutputs(filter: OutputFilter): Promise<Result<OutputEntry[]>> {
        // Sandboxed plugins only see outputs tagged with their pluginId
        const result = await pluginApi.queryOutputs({ ...filter, tags: [...(filter.tags ?? []), `plugin:${pluginId}`] });
        return result;
      },
      async queryVitals(filter: VitalFilter): Promise<Result<VitalRecord[]>> {
        return pluginApi.queryVitals(filter);
      },
      async queryCosts(filter: CostFilter): Promise<Result<CostRecord[]>> {
        return pluginApi.queryCosts(filter);
      },
    } : pluginApi;

    // BRK-014: Sandboxed logger gets plugin ID prefix
    const sandboxedLogger: PluginLogger = isSandboxed ? {
      debug(message: string, data?: Record<string, unknown>) {
        pluginLogger.debug(`[sandbox:${pluginId}] ${message}`, data);
      },
      info(message: string, data?: Record<string, unknown>) {
        pluginLogger.info(`[sandbox:${pluginId}] ${message}`, data);
      },
      warn(message: string, data?: Record<string, unknown>) {
        pluginLogger.warn(`[sandbox:${pluginId}] ${message}`, data);
      },
      error(message: string, data?: Record<string, unknown>) {
        pluginLogger.error(`[sandbox:${pluginId}] ${message}`, data);
      },
    } : pluginLogger;

    const pluginContext: PluginContext = {
      on(event: AgentEvent, handler: AgentEventHandler): string {
        // BRK-014: Sandboxed plugins subscribe to namespaced events
        const eventName = isSandboxed ? `${eventNamespace}${String(event)}` : String(event);
        const subResult = events.subscribe(eventName, (eventPayload) => {
          try {
            handler({
              eventId: '' as unknown as import('../adapters/shared/types.js').EventId,
              event,
              timestamp: time.nowISO(),
              adapterId: '' as unknown as import('../adapters/shared/types.js').AdapterId,
              sessionId: null,
              agentId: '' as unknown as import('../adapters/shared/types.js').AgentId,
              data: eventPayload.payload as Readonly<Record<string, unknown>>,
            });
          } catch { /* OG-12.5: error isolation */ }
        });
        if (subResult.ok) {
          subscriptionIds.push(subResult.value);
          return subResult.value;
        }
        return '';
      },
      off(subscriptionId: string): void {
        events.unsubscribe(subscriptionId);
        const idx = subscriptionIds.indexOf(subscriptionId);
        if (idx !== -1) subscriptionIds.splice(idx, 1);
      },
      api: sandboxedApi,
      logger: sandboxedLogger,
    };

    // OG-7.5: Call plugin.install()
    try {
      await plugin.install(pluginContext);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      appendAudit('plugin.install_error', 'plugin', pluginId, { pluginName: plugin.name, error: errorMessage });
      // BRK-018: Emit plugin:error event when plugin errors occur
      emitEvent('plugin:error', { pluginId, name: plugin.name, error: errorMessage, phase: 'install' });
      return err('PLUGIN_INSTALL_FAILED', errorMessage);
    }

    const entry: PluginEntry = {
      pluginId,
      plugin,
      config: resolvedConfig,
      installedAt: now,
      subscriptionIds,
      status: resolvedConfig.enabled ? 'active' : 'disabled',
      errorCount: 0,
      lastError: null,
    };

    plugins.set(pluginId, entry);

    // Persist to DB — BRK-012: include tenant_id
    try {
      const conn = getConnection();
      const ctx = getContext();
      const tenantId = ctx.tenantId ?? 'default';
      conn.run(
        `INSERT INTO output_plugins (id, tenant_id, name, version, status, installed_at, error_count, last_error, config)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [pluginId, tenantId, plugin.name, plugin.version, entry.status, now, 0, null,
         JSON.stringify(resolvedConfig)],
      );
    } catch { /* DB persistence non-fatal — in-memory is authoritative */ }

    // OG-8.23: plugin:installed event
    emitEvent('plugin:installed', { pluginId, name: plugin.name, version: plugin.version });
    appendAudit('plugin.installed', 'plugin', pluginId, {
      pluginName: plugin.name, version: plugin.version, config: resolvedConfig,
    });

    return ok(pluginId);
  }

  async function uninstall(pluginId: string): Promise<Result<void>> {
    const entry = plugins.get(pluginId);
    if (!entry) {
      return err('PLUGIN_NOT_FOUND', `Plugin not found: ${pluginId}`);
    }

    // OG-7.6: Call plugin.destroy()
    try {
      await entry.plugin.destroy();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      appendAudit('plugin.destroy_error', 'plugin', pluginId, { error: errorMessage });
      // BRK-018: Emit plugin:error event when plugin errors occur during destroy
      emitEvent('plugin:error', { pluginId, name: entry.plugin.name, error: errorMessage, phase: 'destroy' });
    }

    // OG-11.17: Cleanup subscriptions
    for (const subId of entry.subscriptionIds) {
      try { events.unsubscribe(subId); } catch { /* cleanup non-fatal */ }
    }

    plugins.delete(pluginId);

    try {
      const conn = getConnection();
      conn.run('DELETE FROM output_plugins WHERE id = ?', [pluginId]);
    } catch { /* DB cleanup non-fatal */ }

    emitEvent('plugin:uninstalled', { pluginId, name: entry.plugin.name });
    appendAudit('plugin.uninstalled', 'plugin', pluginId, { pluginName: entry.plugin.name });

    return ok(undefined);
  }

  function list(): Result<PluginRegistration[]> {
    const registrations: PluginRegistration[] = [];
    for (const entry of plugins.values()) {
      registrations.push({
        pluginId: entry.pluginId,
        name: entry.plugin.name,
        version: entry.plugin.version,
        status: entry.status,
        installedAt: entry.installedAt,
        errorCount: entry.errorCount,
        lastError: entry.lastError,
        config: entry.config,
      });
    }
    return ok(registrations);
  }

  return { install, uninstall, list };
}
