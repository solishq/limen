/**
 * A2A Agent Card — returned at GET /.well-known/agent.json
 *
 * The Agent Card is the A2A protocol's discovery mechanism. Remote agents
 * fetch this endpoint to learn what skills this agent exposes, what
 * input/output formats it accepts, and what capabilities it supports.
 *
 * Design: The card is a function of the server's URL (which depends on
 * the configured port). Everything else is static — Limen's capabilities
 * do not change at runtime.
 */

export interface AgentCard {
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly version: string;
  readonly capabilities: {
    readonly streaming: boolean;
    readonly pushNotifications: boolean;
  };
  readonly defaultInputModes: readonly string[];
  readonly defaultOutputModes: readonly string[];
  readonly skills: readonly AgentSkill[];
}

export interface AgentSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/**
 * Build the Agent Card for the given base URL.
 *
 * The base URL includes protocol, host, and port (e.g., "http://localhost:41000").
 * It is determined at server startup based on the configured port.
 */
export function buildAgentCard(baseUrl: string): AgentCard {
  return {
    name: 'Limen Cognitive OS',
    description: 'Deterministic infrastructure for AI agent orchestration',
    url: baseUrl,
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [
      {
        id: 'agent-management',
        name: 'Agent Lifecycle Management',
        description: 'Register, list, get, promote agents',
      },
      {
        id: 'claim-management',
        name: 'Knowledge Claim Assertions',
        description: 'Assert, query, relate claims in the CCP',
      },
      {
        id: 'working-memory',
        name: 'Task-Scoped Working Memory',
        description: 'Write, read, discard task working memory',
      },
      {
        id: 'mission-orchestration',
        name: 'Mission & Task Orchestration',
        description: 'Create and list missions',
      },
      {
        id: 'health',
        name: 'System Health & Metrics',
        description: 'Engine health status',
      },
    ],
  };
}
