// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Shared helpers for A2A CLI commands.
 *
 * Extracted from a2a-send, a2a-read, a2a-presence to eliminate duplication.
 * F-BR3-008: 4x isValidName / 3x subject helpers were duplicated.
 *
 * These MUST match the MCP tool implementations at:
 *   packages/limen-mcp/src/tools/a2a-chat.ts
 */

/** Validate channel/agent name: alphanumeric, hyphens, underscores, 1-64 chars. Matches MCP. */
export function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

/** Build the subject URN for a channel. 3-segment URN: entity:channel:{name} */
export function channelSubject(channel: string): string {
  return `entity:channel:${channel}`;
}

/** Build the subject URN for a DM between two agents. Sorted for determinism. */
export function dmSubject(agent1: string, agent2: string): string {
  const sorted = [agent1, agent2].sort();
  return `entity:dm:${sorted[0]}_${sorted[1]}`;
}

/**
 * Injectable clock for timestamps. Defaults to Date.now().
 * F-BR3-004: Constitution Hard Stop #7 requires TimeProvider, never direct Date.now().
 */
export type TimeProvider = () => string;

/** Default time provider using system clock. */
export const systemClock: TimeProvider = () => new Date().toISOString();

/** Shared time provider -- can be overridden for testing. */
let _clock: TimeProvider = systemClock;

/** Get the current clock provider. */
export function getClock(): TimeProvider {
  return _clock;
}

/** Set the clock provider (for testing). */
export function setClock(clock: TimeProvider): void {
  _clock = clock;
}

/** Reset clock to system default. */
export function resetClock(): void {
  _clock = systemClock;
}
