/**
 * Limen CLI Configuration — reads from ~/.limen/config.json.
 *
 * Config hierarchy: CLI flags > env vars > config file > defaults.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface LimenCliConfig {
  readonly dataDir: string;
  readonly masterKeyPath: string;
}

const LIMEN_HOME = join(homedir(), '.limen');
const DEFAULT_CONFIG: LimenCliConfig = {
  dataDir: join(LIMEN_HOME, 'data'),
  masterKeyPath: join(LIMEN_HOME, 'master.key'),
};

export function loadConfig(): LimenCliConfig {
  const configPath = join(LIMEN_HOME, 'config.json');

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<LimenCliConfig>;
    return {
      dataDir: parsed.dataDir ?? DEFAULT_CONFIG.dataDir,
      masterKeyPath: parsed.masterKeyPath ?? DEFAULT_CONFIG.masterKeyPath,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function getLimenHome(): string {
  return LIMEN_HOME;
}
