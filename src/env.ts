import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Load KEY=VALUE lines into process.env (already-set vars are never overwritten). */
function applyEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}

// Loaded as a side-effect import at the top of server.ts, before any other
// module reads process.env — .env.local wins over .env for values present
// in both, since applyEnvFile only sets keys not already set and this list
// applies .env.local first.
for (const file of ['.env.local', '.env']) {
  applyEnvFile(join(process.cwd(), file));
}
