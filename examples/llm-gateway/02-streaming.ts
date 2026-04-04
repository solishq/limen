import { createLimen } from 'limen-ai';

const limen = await createLimen();

const result = limen.chat('Explain how neural networks learn', { stream: true });

for await (const chunk of result.stream) {
  if (chunk.type === 'content_delta') process.stdout.write(chunk.delta);
}
console.log(); // newline after streaming completes

await limen.shutdown();
