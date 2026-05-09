// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
import { createLimen } from 'limen-ai';

const limen = await createLimen();
console.log(await limen.chat('What is quantum computing?').text);
await limen.shutdown();
