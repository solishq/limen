import { createLimen } from 'limen-ai';

const limen = await createLimen();

const result = await limen.infer({
  input: 'List the top 3 programming languages by popularity in 2025',
  outputSchema: {
    type: 'object',
    properties: {
      languages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['name', 'reason'],
        },
      },
    },
    required: ['languages'],
  },
  maxRetries: 2,
});

console.log(JSON.stringify(result.data, null, 2));
console.log(`Tokens: ${result.usage.totalTokens} | Retries: ${result.retryCount}`);

await limen.shutdown();
