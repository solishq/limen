# Limen Examples

## Prerequisites

- Node.js >= 22
- `npm install` in the root directory

Run any example with:

```bash
npx tsx examples/<category>/<file>.ts
```

## Knowledge (Core)

| File | Description | LLM Required |
|------|-------------|:------------:|
| `knowledge/01-remember-recall.ts` | Store and retrieve beliefs | No |
| `knowledge/02-search-and-decay.ts` | Full-text search, temporal decay | No |
| `knowledge/03-governance.ts` | Confidence ceilings, conflict detection | No |

**Start here.** These examples cover the core API in under 5 minutes.

## Advanced

| File | Description | LLM Required |
|------|-------------|:------------:|
| `advanced/07-knowledge.ts` | Advanced knowledge operations | No |
| `advanced/08-governance-visible.ts` | Classification, protected predicates | No |

## LLM Gateway

| File | Description | LLM Required |
|------|-------------|:------------:|
| `llm-gateway/01-hello.ts` | Basic chat completion | Yes |
| `llm-gateway/02-streaming.ts` | Streaming responses | Yes |
| `llm-gateway/03-structured-output.ts` | JSON schema output | Yes |
| `llm-gateway/04-multi-provider.ts` | Multi-provider failover | Yes |
| `llm-gateway/05-sessions.ts` | Stateful sessions | Yes |
| `llm-gateway/06-missions.ts` | Mission-based workflows | Yes |

LLM examples require a provider key (e.g., `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`).

## Recommended Order

1. `knowledge/01-remember-recall.ts` (3 min)
2. `knowledge/02-search-and-decay.ts` (3 min)
3. `knowledge/03-governance.ts` (5 min)
4. `advanced/07-knowledge.ts` (5 min)
5. `llm-gateway/01-hello.ts` (requires LLM key)
