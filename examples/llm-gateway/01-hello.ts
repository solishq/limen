import { createLimen } from 'limen-ai';

const limen = await createLimen();
console.log(await limen.chat('What is quantum computing?').text);
await limen.shutdown();
