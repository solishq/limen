/**
 * AST-based check for explicit `any` type usage in TypeScript source.
 *
 * Why this exists: grep-based checks produce false positives on comments
 * and string literals. The TypeScript compiler API understands syntax —
 * it only flags actual `any` type annotations and `as any` assertions.
 *
 * What it catches:
 *   - `: any` type annotations
 *   - `as any` type assertions
 *   - `<any>` legacy type assertions
 *
 * What it ignores:
 *   - Comments containing the word "any"
 *   - String literals containing "any"
 *   - `noImplicitAny` violations (handled by tsc --noEmit with strict: true)
 */

import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_DIR = join(import.meta.dirname, '..', 'src');

interface Violation {
  file: string;
  line: number;
  text: string;
}

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

function findExplicitAny(filePath: string): Violation[] {
  const source = readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );

  const violations: Violation[] = [];

  function visit(node: ts.Node): void {
    // `: any` — type annotation using the `any` keyword
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      violations.push({
        file: relative(process.cwd(), filePath),
        line: line + 1,
        text: source.split('\n')[line].trim(),
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

const files = collectTsFiles(SRC_DIR);
const allViolations: Violation[] = [];

for (const file of files) {
  allViolations.push(...findExplicitAny(file));
}

if (allViolations.length > 0) {
  console.error(`Found ${allViolations.length} explicit 'any' type usage(s):\n`);
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  process.exit(1);
} else {
  console.log(`Checked ${files.length} files — no explicit 'any' types found.`);
  process.exit(0);
}
