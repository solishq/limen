import { createLimen } from '../src/api/index.js';

const limen = await createLimen();
console.log(await limen.chat('What is quantum computing?').text);
await limen.shutdown();
