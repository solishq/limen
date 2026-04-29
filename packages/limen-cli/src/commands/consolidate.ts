/**
 * limen consolidate — Run cognitive consolidation.
 *
 * Wraps limen.cognitive.consolidate(options?) to merge similar claims,
 * archive stale low-confidence claims, and suggest contradiction resolutions.
 *
 * Parity with: limen_consolidate MCP tool.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createConsolidateCommand(): Command {
  const cmd = new Command('consolidate')
    .description('Run cognitive consolidation: merge, archive, and suggest resolutions')
    .option('--mergeSimilarityThreshold <n>', 'Similarity threshold for merging (default: 0.98)', parseFloat)
    .option('--archiveMaxConfidence <n>', 'Max confidence for archive candidates (default: 0.3)', parseFloat)
    .option('--archiveMaxAccessCount <n>', 'Max access count for archive candidates (default: 1)', parseInt)
    .option('--dryRun', 'Preview changes without applying')
    .action(async (options: {
      mergeSimilarityThreshold?: number;
      archiveMaxConfidence?: number;
      archiveMaxAccessCount?: number;
      dryRun?: boolean;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const hasOptions = options.mergeSimilarityThreshold !== undefined ||
          options.archiveMaxConfidence !== undefined ||
          options.archiveMaxAccessCount !== undefined ||
          options.dryRun !== undefined;

        const consolidateOptions = hasOptions
          ? {
              mergeSimilarityThreshold: options.mergeSimilarityThreshold,
              archiveFreshnessFilter: 'stale' as const,
              archiveMaxConfidence: options.archiveMaxConfidence,
              archiveMaxAccessCount: options.archiveMaxAccessCount,
              dryRun: options.dryRun,
            }
          : undefined;

        const result = await withEngine(
          (limen) => {
            const r = limen.cognitive.consolidate(consolidateOptions);
            if (!r.ok) {
              throw new CliError(r.error.code, `Consolidation failed: ${r.error.message}`);
            }
            return r.value;
          },
          { dataDir: globals.dataDir, masterKeyPath: globals.masterKey },
        );

        writeResult(result);
      } catch (err: unknown) {
        writeError(err);
        process.exitCode = 1;
      }
    });

  return cmd;
}
