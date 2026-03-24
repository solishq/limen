import { createLimen } from '../src/api/index.js';

const limen = await createLimen();

// Register an agent with capabilities
await limen.agents.register({
  name: 'researcher',
  capabilities: ['web', 'data'],
});

// Create a budget-governed autonomous mission
const mission = await limen.missions.create({
  agent: 'researcher',
  objective: 'Analyze the renewable energy market in Europe',
  constraints: {
    tokenBudget: 50_000,
    deadline: new Date(Date.now() + 3_600_000).toISOString(), // 1 hour
    capabilities: ['web', 'data'],
    maxTasks: 10,
  },
  deliverables: [
    { type: 'report', name: 'market-analysis' },
    { type: 'data', name: 'market-data' },
  ],
});

console.log(`Mission ${mission.id} — state: ${mission.state}`);
console.log(`Budget: ${mission.budget.allocated} tokens`);

// Monitor progress
mission.on('checkpoint', (payload) => {
  console.log('Checkpoint:', payload);
});

// Wait for completion
const result = await mission.wait();
console.log(`\nResult: ${result.state}`);
console.log(`Summary: ${result.summary}`);
console.log(`Confidence: ${result.confidence}`);
console.log(`Artifacts: ${result.artifacts.length}`);
console.log(`Tokens used: ${result.resourcesConsumed.tokens}`);

await limen.shutdown();
