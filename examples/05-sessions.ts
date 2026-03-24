import { createLimen } from '../src/api/index.js';

const limen = await createLimen();

// Sessions maintain conversation memory across turns
const session = await limen.session({
  agentName: 'tutor',
  user: { id: 'student-1', role: 'learner' },
});

// Multi-turn conversation — each turn sees prior context
const r1 = session.chat('What is photosynthesis?');
console.log('Turn 1:', await r1.text);

const r2 = session.chat('What role does chlorophyll play in it?');
console.log('Turn 2:', await r2.text);

const r3 = session.chat('Summarize what we discussed');
console.log('Turn 3:', await r3.text);

// Inspect conversation history
const history = await session.history();
console.log(`\nConversation: ${history.length} turns`);

// Fork at turn 2 to explore a different direction
const branch = await session.fork(2);
const alt = branch.chat('What about artificial photosynthesis?');
console.log('\nBranch:', await alt.text);

await branch.close();
await session.close();
await limen.shutdown();
