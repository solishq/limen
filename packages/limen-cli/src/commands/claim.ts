/**
 * limen claim — Claim management commands.
 *
 * Subcommands: assert, query.
 * Claims are the knowledge primitive in Limen — structured assertions
 * with confidence scores and grounding evidence.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError } from '../output.js';
import type { Limen, MissionId, TaskId, ClaimApi } from 'limen-ai';

export function createClaimCommand(): Command {
  const claim = new Command('claim')
    .description('Manage Limen claims');

  // limen claim assert --subject <s> --predicate <p> --object <json>
  //   --confidence <n> --grounding <mode> --validAt <iso> --missionId <m>
  //   [--taskId <t>] [--evidenceRefs <json>]
  claim
    .command('assert')
    .description('Assert a new claim')
    .requiredOption('--subject <subject>', 'Subject URN (entity:type:id)')
    .requiredOption('--predicate <predicate>', 'Predicate (domain.property)')
    .requiredOption('--object <json>', 'Object value as JSON (e.g. {"type":"string","value":"hello"})')
    .requiredOption('--confidence <n>', 'Confidence score (0-1)', parseFloat)
    .requiredOption('--grounding <mode>', 'Grounding mode (evidence_path|runtime_witness)')
    .requiredOption('--validAt <iso>', 'Temporal anchor (ISO 8601)')
    .requiredOption('--missionId <id>', 'Mission context ID')
    .option('--taskId <id>', 'Task context ID')
    .option('--evidenceRefs <json>', 'Evidence references as JSON array')
    .action(async (options: {
      subject: string;
      predicate: string;
      object: string;
      confidence: number;
      grounding: string;
      validAt: string;
      missionId: string;
      taskId?: string;
      evidenceRefs?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        let parsedObject: { readonly type: string; readonly value: unknown };
        try {
          parsedObject = JSON.parse(options.object) as { type: string; value: unknown };
        } catch {
          writeError(new Error(`Invalid JSON for --object: ${options.object}`));
          process.exitCode = 1;
          return;
        }

        let evidenceRefs: readonly { readonly type: string; readonly id: string }[] = [];
        if (options.evidenceRefs) {
          try {
            evidenceRefs = JSON.parse(options.evidenceRefs) as { type: string; id: string }[];
          } catch {
            writeError(new Error(`Invalid JSON for --evidenceRefs: ${options.evidenceRefs}`));
            process.exitCode = 1;
            return;
          }
        }

        const result = await withEngine(
          (limen: Limen) => {
            const api: ClaimApi = limen.claims;
            // ClaimCreateInput fields are typed with string literal unions
            // (GroundingMode, ObjectType, EvidenceType) which are not exported.
            // CLI string inputs are validated at runtime by the claim system.
            const claimResult = api.assertClaim({
              subject: options.subject,
              predicate: options.predicate,
              object: parsedObject,
              confidence: options.confidence,
              groundingMode: options.grounding,
              validAt: options.validAt,
              missionId: options.missionId as MissionId,
              taskId: (options.taskId ?? null) as TaskId | null,
              evidenceRefs,
            } as Parameters<ClaimApi['assertClaim']>[0]);

            if (!claimResult.ok) {
              throw new Error(`Claim assertion failed: ${claimResult.error.message}`);
            }
            return claimResult.value;
          },
          {
            dataDir: globals.dataDir,
            masterKeyPath: globals.masterKey,
          },
        );

        writeResult(result);
      } catch (err: unknown) {
        writeError(err);
        process.exitCode = 1;
      }
    });

  // limen claim query [--subject <s>] [--predicate <p>]
  claim
    .command('query')
    .description('Query claims')
    .option('--subject <subject>', 'Subject filter (supports trailing wildcard)')
    .option('--predicate <predicate>', 'Predicate filter (supports trailing wildcard)')
    .option('--minConfidence <n>', 'Minimum confidence threshold', parseFloat)
    .option('--limit <n>', 'Maximum results', parseInt)
    .action(async (options: {
      subject?: string;
      predicate?: string;
      minConfidence?: number;
      limit?: number;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          (limen: Limen) => {
            const api: ClaimApi = limen.claims;
            const queryResult = api.queryClaims({
              subject: options.subject ?? null,
              predicate: options.predicate ?? null,
              minConfidence: options.minConfidence ?? null,
              limit: options.limit,
            });

            if (!queryResult.ok) {
              throw new Error(`Claim query failed: ${queryResult.error.message}`);
            }
            return queryResult.value;
          },
          {
            dataDir: globals.dataDir,
            masterKeyPath: globals.masterKey,
          },
        );

        writeResult(result);
      } catch (err: unknown) {
        writeError(err);
        process.exitCode = 1;
      }
    });

  return claim;
}
