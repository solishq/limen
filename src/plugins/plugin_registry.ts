/**
 * Phase 8 Plugin Registry — lifecycle management and event hook wiring.
 *
 * Design Source: PHASE-8-DESIGN-SOURCE.md (Output 1, 2, 3)
 * Truth Model: PHASE-8-TRUTH-MODEL.md (I-P8-01 through I-P8-13)
 *
 * This is the implementation layer. All business logic for plugin lifecycle,
 * event mapping, and error isolation lives here.
 *
 * Architecture: plugin_types.ts (contract) -> plugin_registry.ts (implementation)
 *
 * Invariants enforced:
 *   I-P8-01: Plugin install before freeze
 *   I-P8-02: Plugin name uniqueness
 *   I-P8-03: API not callable during install
 *   I-P8-04: Destroy in reverse order
 *   I-P8-05: Max plugin count
 *   I-P8-06: Install failure non-fatal
 *   I-P8-10: Event name mapping
 *   I-P8-11: Handler error isolation
 */

import type { Result } from '../kernel/interfaces/index.js';
import type { EventBus, EventPayload } from '../kernel/interfaces/events.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type {
  LimenPlugin,
  LimenEventName,
  LimenEventHandler,
  LimenEvent,
  PluginContext,
  PluginApi,
  PluginLogger,
  InstalledPlugin,
} from './plugin_types.js';
import {
  MAX_PLUGINS,
  VALID_EVENT_NAMES,
  EVENT_NAME_MAP,
  REVERSE_EVENT_MAP,
} from './plugin_types.js';

// ── Result Helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message, spec: 'Phase-8' } };
}

// ── Logger Types ──

export type LogCallback = (level: string, category: string, message: string, context?: Record<string, unknown>) => void;

// ── Plugin Registry ──

export interface PluginRegistry {
  /**
   * Install all plugins from config.
   * Called once during createLimen(), before deepFreeze().
   *
   * I-P8-01: All installs happen before freeze.
   * I-P8-06: Individual failures are non-fatal.
   */
  installAll(plugins: readonly LimenPlugin[], pluginConfig?: Readonly<Record<string, Readonly<Record<string, unknown>>>>): Result<void>;

  /**
   * Enable API access for plugins.
   * Called after engine construction is complete but before freeze.
   * Unlocks the PluginApi proxy so deferred calls work.
   *
   * I-P8-03: Before this call, all API methods throw PLUGIN_API_NOT_READY.
   */
  enableApi(): void;

  /**
   * Destroy all plugins in reverse install order.
   * Called during shutdown().
   *
   * I-P8-04: Reverse order.
   * DC-P8-204: Destroy failure non-fatal.
   */
  destroyAll(): Promise<void>;

  /**
   * Subscribe to a consumer-facing event.
   * Maps consumer event name to internal EventBus pattern.
   *
   * I-P8-10: Event name mapping.
   * I-P8-11: Handler error isolation.
   */
  on(event: LimenEventName, handler: LimenEventHandler): Result<string>;

  /**
   * Unsubscribe from events by subscription ID.
   */
  off(subscriptionId: string): Result<void>;

  /** Get installed plugin count */
  readonly pluginCount: number;

  /** Get installed plugin names */
  readonly pluginNames: readonly string[];
}

/**
 * Dependencies for the plugin registry.
 */
export interface PluginRegistryDeps {
  readonly eventBus: EventBus;
  readonly time: TimeProvider;
  readonly log: LogCallback;
  /**
   * The Limen convenience API methods.
   * Initially null — set after engine construction via enableApi().
   */
  readonly apiProvider: () => PluginApi | null;
}

/**
 * Create the plugin registry.
 *
 * Called during createLimen(), before plugin installation.
 * The registry manages the full plugin lifecycle.
 */
export function createPluginRegistry(deps: PluginRegistryDeps): PluginRegistry {
  const { eventBus, time, log, apiProvider } = deps;

  // Mutable state — lives in closure, safe after freeze
  const installed: InstalledPlugin[] = [];
  let apiEnabled = false;

  // Track consumer event subscriptions for on()/off()
  // Maps consumer subscription ID to internal EventBus subscription ID
  const subscriptionMap = new Map<string, string>();
  let subscriptionCounter = 0;

  /**
   * Create an error-isolating event handler wrapper.
   *
   * I-P8-11: One handler throwing must not prevent other handlers.
   * The EventBus dispatches synchronously (RDD-4). We wrap each consumer
   * handler in try/catch before registering with the EventBus.
   */
  function wrapHandler(
    handler: LimenEventHandler,
    consumerEventName: LimenEventName,
    pluginName?: string,
  ): (event: EventPayload) => void {
    return (internalEvent: EventPayload) => {
      try {
        // Translate internal event to consumer event
        const consumerType = REVERSE_EVENT_MAP.get(internalEvent.type) ?? consumerEventName;
        const consumerEvent: LimenEvent = {
          type: consumerType,
          data: internalEvent.payload,
          timestamp: time.nowISO(),
        };
        handler(consumerEvent);
      } catch (handlerError) {
        // I-P8-11: Error isolation — log and continue
        const source = pluginName ? `plugin:${pluginName}` : 'consumer';
        log('warn', 'event', `Event handler error (${source}): ${handlerError instanceof Error ? handlerError.message : String(handlerError)}`, {
          eventType: internalEvent.type,
          source,
        });
      }
    };
  }

  /**
   * Create a PluginLogger scoped to a plugin name.
   */
  function createPluginLogger(pluginName: string): PluginLogger {
    return {
      debug(message: string, context?: Record<string, unknown>) {
        log('debug', `plugin:${pluginName}`, message, context);
      },
      info(message: string, context?: Record<string, unknown>) {
        log('info', `plugin:${pluginName}`, message, context);
      },
      warn(message: string, context?: Record<string, unknown>) {
        log('warn', `plugin:${pluginName}`, message, context);
      },
      error(message: string, context?: Record<string, unknown>) {
        log('error', `plugin:${pluginName}`, message, context);
      },
    };
  }

  /**
   * Create a PluginApi proxy that guards against install-time calls.
   *
   * I-P8-03: Before enableApi(), all methods throw PLUGIN_API_NOT_READY.
   * After enableApi(), methods delegate to the real Limen convenience API.
   */
  function createApiProxy(): PluginApi {
    const guard = (methodName: string): never => {
      throw new Error(`PLUGIN_API_NOT_READY: Cannot call api.${methodName}() during plugin install. Store the api reference and use it in event handlers or deferred callbacks.`);
    };

    return {
      remember(subject: string, predicate: string, value: string, options?: unknown) {
        if (!apiEnabled) return guard('remember');
        const api = apiProvider();
        if (!api) return guard('remember');
        return api.remember(subject, predicate, value, options);
      },
      recall(subject?: string, predicate?: string, options?: unknown) {
        if (!apiEnabled) return guard('recall');
        const api = apiProvider();
        if (!api) return guard('recall');
        return api.recall(subject, predicate, options);
      },
      forget(claimId: string, reason?: string) {
        if (!apiEnabled) return guard('forget');
        const api = apiProvider();
        if (!api) return guard('forget');
        return api.forget(claimId, reason);
      },
      search(query: string, options?: unknown) {
        if (!apiEnabled) return guard('search');
        const api = apiProvider();
        if (!api) return guard('search');
        return api.search(query, options);
      },
      connect(claimId1: string, claimId2: string, type: string) {
        if (!apiEnabled) return guard('connect');
        const api = apiProvider();
        if (!api) return guard('connect');
        return api.connect(claimId1, claimId2, type);
      },
    };
  }

  /**
   * Subscribe to a consumer event via the internal EventBus.
   *
   * I-P8-10: Map consumer name to internal pattern.
   * For wildcard '*', subscribe to internal '*' pattern.
   */
  function subscribeToEvent(
    event: LimenEventName,
    handler: LimenEventHandler,
    pluginName?: string,
  ): Result<string> {
    // Validate event name (DC-P8-405)
    if (!VALID_EVENT_NAMES.has(event)) {
      return err('PLUGIN_INVALID_EVENT', `Unknown event name: '${event}'. Valid names: ${Array.from(VALID_EVENT_NAMES).join(', ')}`);
    }

    // Map consumer name to internal pattern
    const internalPattern = event === '*' ? '*' : EVENT_NAME_MAP.get(event);
    if (!internalPattern && event !== '*') {
      return err('PLUGIN_INVALID_EVENT', `No internal mapping for event: '${event}'`);
    }

    const pattern = internalPattern ?? '*';
    const wrappedHandler = wrapHandler(handler, event, pluginName);

    const subResult = eventBus.subscribe(pattern, wrappedHandler);
    if (!subResult.ok) return subResult;

    // Generate consumer-facing subscription ID
    const consumerId = `p8-sub-${++subscriptionCounter}`;
    subscriptionMap.set(consumerId, subResult.value);

    return ok(consumerId);
  }

  return {
    installAll(plugins, pluginConfig) {
      if (!plugins || plugins.length === 0) return ok(undefined);

      // I-P8-05: Max plugin count
      if (plugins.length > MAX_PLUGINS) {
        return err('PLUGIN_MAX_EXCEEDED', `Cannot install ${plugins.length} plugins. Maximum is ${MAX_PLUGINS}.`);
      }

      for (const plugin of plugins) {
        // DC-P8-404: Validate meta
        if (!plugin.meta?.name || typeof plugin.meta.name !== 'string' || plugin.meta.name.trim() === '') {
          log('error', 'plugin', `Plugin has invalid meta: missing or empty name`, { meta: plugin.meta });
          continue; // I-P8-06: non-fatal, skip
        }
        if (!plugin.meta?.version || typeof plugin.meta.version !== 'string' || plugin.meta.version.trim() === '') {
          log('error', 'plugin', `Plugin '${plugin.meta.name}' has invalid meta: missing or empty version`, { meta: plugin.meta });
          continue; // I-P8-06: non-fatal, skip
        }

        // I-P8-02: Name uniqueness
        if (installed.some(p => p.plugin.meta.name === plugin.meta.name)) {
          log('error', 'plugin', `Plugin name '${plugin.meta.name}' already installed. Skipping duplicate.`);
          continue; // I-P8-06: non-fatal, skip
        }

        const entry: InstalledPlugin = {
          plugin,
          subscriptionIds: [],
          installedAt: time.nowISO(),
          state: 'registered',
        };

        // Create context for this plugin
        const pluginCfg = pluginConfig?.[plugin.meta.name] ?? {};
        const pluginLogger = createPluginLogger(plugin.meta.name);
        const apiProxy = createApiProxy();

        const context: PluginContext = {
          on(event: LimenEventName, handler: LimenEventHandler): string {
            const result = subscribeToEvent(event, handler, plugin.meta.name);
            if (result.ok) {
              (entry.subscriptionIds as string[]).push(result.value);
              return result.value;
            }
            throw new Error(result.error.message);
          },
          off(subscriptionId: string): void {
            const internalId = subscriptionMap.get(subscriptionId);
            if (internalId) {
              eventBus.unsubscribe(internalId);
              subscriptionMap.delete(subscriptionId);
              const idx = (entry.subscriptionIds as string[]).indexOf(subscriptionId);
              if (idx >= 0) (entry.subscriptionIds as string[]).splice(idx, 1);
            }
          },
          api: apiProxy,
          config: pluginCfg,
          log: pluginLogger,
        };

        // Install
        entry.state = 'installing';
        try {
          plugin.install(context);
          entry.state = 'installed';
          installed.push(entry);
          log('info', 'plugin', `Plugin '${plugin.meta.name}@${plugin.meta.version}' installed`, {
            subscriptions: entry.subscriptionIds.length,
          });
        } catch (installError) {
          // I-P8-06, DC-P8-202: Install failure non-fatal
          entry.state = 'failed';
          log('error', 'plugin', `Plugin '${plugin.meta.name}' install failed: ${installError instanceof Error ? installError.message : String(installError)}`, {
            pluginName: plugin.meta.name,
          });
        }
      }

      return ok(undefined);
    },

    enableApi() {
      // I-P8-03: Unlock API proxy
      apiEnabled = true;
    },

    async destroyAll() {
      // I-P8-04: Reverse order
      for (let i = installed.length - 1; i >= 0; i--) {
        const entry = installed[i]!;
        if (entry.state !== 'installed') continue;

        entry.state = 'destroying';
        try {
          if (entry.plugin.destroy) {
            await entry.plugin.destroy();
          }
          entry.state = 'destroyed';

          // Clean up subscriptions
          for (const subId of entry.subscriptionIds) {
            const internalId = subscriptionMap.get(subId);
            if (internalId) {
              eventBus.unsubscribe(internalId);
              subscriptionMap.delete(subId);
            }
          }

          log('info', 'plugin', `Plugin '${entry.plugin.meta.name}' destroyed`);
        } catch (destroyError) {
          // DC-P8-204: Destroy failure non-fatal
          entry.state = 'failed';
          log('error', 'plugin', `Plugin '${entry.plugin.meta.name}' destroy failed: ${destroyError instanceof Error ? destroyError.message : String(destroyError)}`, {
            pluginName: entry.plugin.meta.name,
          });
        }
      }
    },

    on(event: LimenEventName, handler: LimenEventHandler): Result<string> {
      return subscribeToEvent(event, handler);
    },

    off(subscriptionId: string): Result<void> {
      const internalId = subscriptionMap.get(subscriptionId);
      if (!internalId) {
        return ok(undefined); // Idempotent — already unsubscribed or never subscribed
      }
      const result = eventBus.unsubscribe(internalId);
      subscriptionMap.delete(subscriptionId);
      return result;
    },

    get pluginCount() {
      return installed.filter(p => p.state === 'installed').length;
    },

    get pluginNames() {
      return installed.filter(p => p.state === 'installed').map(p => p.plugin.meta.name);
    },
  };
}
