import { createLimen } from 'limen-ai';

// ─── Multi-Provider Routing ───
//
// Zero-config detects ALL providers from environment variables automatically.
// If you set both ANTHROPIC_API_KEY and OPENAI_API_KEY, Limen sees both.
// No configuration needed — auto-routing picks the best available provider.

const limen = await createLimen();

// Auto-routing: the engine selects the best available provider
const auto = limen.chat('Summarize the history of computing');
console.log('Auto-routed:', await auto.text);

// Explicit model selection: override routing to target a specific model.
// This only works if the provider for that model was detected from env vars.
const explicit = limen.chat('Same question, different model', {
  routing: 'explicit',
  model: 'gpt-4o',
});
console.log('GPT-4o:', await explicit.text);

await limen.shutdown();

// ─── Customized: Explicit Provider Configuration ───
//
// For production or when you need control over which models are available,
// pass providers explicitly. This is the same behavior as zero-config but
// with full control over base URLs, model lists, and provider selection.
//
//   import { createLimen } from 'limen-ai';
//
//   const limen = await createLimen({
//     dataDir: '/var/lib/myapp/limen',
//     masterKey: Buffer.from(process.env.LIMEN_MASTER_KEY!, 'hex'),
//     providers: [
//       {
//         type: 'anthropic',
//         baseUrl: 'https://api.anthropic.com',
//         models: ['claude-sonnet-4-20250514'],
//         apiKeyEnvVar: 'ANTHROPIC_API_KEY',
//       },
//       {
//         type: 'openai',
//         baseUrl: 'https://api.openai.com',
//         models: ['gpt-4o'],
//         apiKeyEnvVar: 'OPENAI_API_KEY',
//       },
//     ],
//   });
