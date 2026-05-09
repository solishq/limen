// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
import { createLimen } from 'limen-ai';

const limen = await createLimen();

const result = limen.chat('Explain how neural networks learn', { stream: true });

for await (const chunk of result.stream) {
  if (chunk.type === 'content_delta') process.stdout.write(chunk.delta);
}
console.log(); // newline after streaming completes

await limen.shutdown();
