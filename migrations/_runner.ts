/**
 * Migration runner — Alembic-style numbered migrations against libSQL/Turso.
 *
 * Discovers every `NNNN_<name>.ts` file in this directory, reads which IDs
 * are already in the `_migrations` ledger table, and applies the rest in
 * order. Each migration file exports a single `migration` object whose
 * `up(db)` receives a libSQL client.
 *
 * Commands (also wired via `npm run db:migrate*`):
 *
 *   tsx migrations/_runner.ts                # apply all pending
 *   tsx migrations/_runner.ts --list         # show status of every migration
 *   tsx migrations/_runner.ts --baseline     # mark all current files applied
 *                                            #   without running them (for
 *                                            #   adopting this system on an
 *                                            #   existing prod DB)
 *
 * Conventions:
 *   - Filenames: `NNNN_short_snake_case.ts`. NNNN is a 4-digit ordinal.
 *   - The `id` field on the exported migration MUST equal the filename
 *     without `.ts` — the runner enforces this.
 *   - Migrations are idempotent at the SQL level (use CREATE TABLE IF NOT
 *     EXISTS, PRAGMA table_info checks, etc.). Even though the ledger
 *     guarantees one-shot execution, idempotency is the safety net when
 *     someone runs an old migration against a partially-rebuilt DB.
 *   - No `down()`. Forward-only. If you need to revert, write a new
 *     migration that undoes it.
 */
import { createClient, type Client } from '@libsql/client';
import * as dotenv from 'dotenv';
import { readdirSync } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: '.env.local' });

export interface Migration {
  /** Must equal the filename without `.ts`. */
  id: string;
  /** One-sentence description of what the migration does. Surfaces in --list. */
  description: string;
  /** Apply the migration. Use the supplied libSQL client; do not open your own. */
  up: (db: Client) => Promise<void>;
}

const MIGRATIONS_DIR = (() => {
  // Works under both `tsx` (ESM) and direct ts-node (CJS).
  if (typeof __dirname !== 'undefined') return __dirname;
  return dirname(fileURLToPath(import.meta.url));
})();

async function ensureLedger(db: Client) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          TEXT PRIMARY KEY,
      description TEXT,
      applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function appliedIds(db: Client): Promise<Set<string>> {
  await ensureLedger(db);
  const r = await db.execute(`SELECT id FROM _migrations`);
  return new Set(r.rows.map((row: unknown) => (row as { id: string }).id));
}

async function loadMigrations(): Promise<Migration[]> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.ts$/.test(f))
    .sort();

  const out: Migration[] = [];
  for (const f of files) {
    const path = join(MIGRATIONS_DIR, f);
    const mod: { migration?: Migration } = await import(path);
    if (!mod.migration) {
      throw new Error(`${f} does not export a "migration" object`);
    }
    const expectedId = basename(f, '.ts');
    if (mod.migration.id !== expectedId) {
      throw new Error(
        `${f}: migration.id ("${mod.migration.id}") must match the filename ("${expectedId}")`
      );
    }
    out.push(mod.migration);
  }
  return out;
}

function makeDb(): Client {
  if (!process.env.TURSO_DATABASE_URL) {
    throw new Error('TURSO_DATABASE_URL not set in .env.local');
  }
  return createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

async function cmdList() {
  const db = makeDb();
  const [migrations, applied] = await Promise.all([loadMigrations(), appliedIds(db)]);
  console.log('Migrations:');
  for (const m of migrations) {
    const mark = applied.has(m.id) ? '✓' : '○';
    console.log(`  ${mark}  ${m.id.padEnd(48)}  ${m.description}`);
  }
  const pending = migrations.filter((m) => !applied.has(m.id)).length;
  console.log(
    `\n${migrations.length} total · ${migrations.length - pending} applied · ${pending} pending`
  );
}

async function cmdBaseline() {
  const db = makeDb();
  const [migrations, applied] = await Promise.all([loadMigrations(), appliedIds(db)]);
  let n = 0;
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    await db.execute({
      sql: `INSERT INTO _migrations (id, description) VALUES (?, ?)`,
      args: [m.id, m.description],
    });
    console.log(`  marked applied (no-op): ${m.id}`);
    n++;
  }
  console.log(
    `\nBaselined ${n} migration${n === 1 ? '' : 's'}. Use this once on an existing prod DB; subsequent runs apply only NEW migrations.`
  );
}

async function cmdApply() {
  const db = makeDb();
  const [migrations, applied] = await Promise.all([loadMigrations(), appliedIds(db)]);
  const pending = migrations.filter((m) => !applied.has(m.id));
  if (pending.length === 0) {
    console.log('All migrations applied. Nothing to do.');
    return;
  }
  console.log(`Applying ${pending.length} migration${pending.length === 1 ? '' : 's'}:`);
  for (const m of pending) {
    console.log(`\n→ ${m.id} — ${m.description}`);
    try {
      await m.up(db);
      await db.execute({
        sql: `INSERT INTO _migrations (id, description) VALUES (?, ?)`,
        args: [m.id, m.description],
      });
      console.log(`  ✓ applied`);
    } catch (e) {
      console.error(`  ✗ FAILED: ${e instanceof Error ? e.message : String(e)}`);
      if (e instanceof Error && e.stack) {
        console.error(e.stack.split('\n').slice(0, 6).join('\n'));
      }
      process.exit(1);
    }
  }
  console.log('\nDone.');
}

async function main() {
  const flag = process.argv[2];
  if (flag === '--list') return cmdList();
  if (flag === '--baseline') return cmdBaseline();
  if (flag === '--help' || flag === '-h') {
    console.log(
      [
        'tsx migrations/_runner.ts             apply all pending migrations',
        'tsx migrations/_runner.ts --list      show status of every migration',
        'tsx migrations/_runner.ts --baseline  mark every current file applied without running it',
      ].join('\n')
    );
    return;
  }
  return cmdApply();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
