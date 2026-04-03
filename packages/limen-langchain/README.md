# @solishq/limen-langchain

LangChain memory adapter for [Limen](https://github.com/solishq/limen) -- governed knowledge engine for AI agents.

Stores LangChain conversation history as governed beliefs in Limen. Each message becomes a claim with confidence, temporal decay, and audit trail.

## Install

```bash
npm install @solishq/limen-langchain limen-ai @langchain/core
```

`limen-ai` and `@langchain/core` are peer dependencies.

## Quick Start

```typescript
import { createLimen } from 'limen-ai';
import { createLimenMemory } from '@solishq/limen-langchain';

const limen = await createLimen();
const memory = createLimenMemory({ limen });

// Save conversation context
await memory.saveContext(
  { input: 'What is Limen?' },
  { output: 'A cognitive infrastructure engine for AI agents.' },
);

// Load memory variables
const vars = await memory.loadMemoryVariables({});
console.log(vars.history);
// "Human: What is Limen?\nAI: A cognitive infrastructure engine for AI agents."

// Clear all conversation history
await memory.clear();

await limen.shutdown();
```

## Configuration

```typescript
const memory = createLimenMemory({
  limen,                          // Required: Limen instance
  subjectPrefix: 'langchain:memory', // Subject prefix for stored claims (default)
  maxMemories: 20,                // Max memories per load (default: 20)
  minConfidence: 0.3,             // Min confidence threshold (default: 0.3)
  memoryKey: 'history',           // Output variable key (default: 'history')
  humanPrefix: 'Human',          // Human message prefix (default: 'Human')
  aiPrefix: 'AI',                // AI message prefix (default: 'AI')
});
```

## API

| Method | Description |
|---|---|
| `memoryVariables` | Readonly array of memory keys this adapter provides |
| `loadMemoryVariables(values)` | Retrieve recent beliefs from Limen, formatted as conversation history |
| `saveContext(inputValues, outputValues)` | Store human and AI messages as beliefs in Limen |
| `clear()` | Retract all claims managed by this adapter |

The adapter implements the LangChain `BaseMemory` interface contract. Input values are read from `input` or `question` keys. Output values are read from `output`, `response`, or `text` keys.

Conversation history is stored as individual claims with predicate `langchain.message`. Beliefs decay over time via Limen's FSRS-based temporal metabolism -- older conversation turns naturally lose influence.

## License

[Apache License 2.0](../../LICENSE)
