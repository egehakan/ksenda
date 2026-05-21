/**
 * Create GenerationJob table — progress tracking for long-running operations
 * (imports, follow-up generation, automation runs).
 */
import type { Client } from '@libsql/client';
import type { Migration } from './_runner';

async function tableExists(db: Client, name: string): Promise<boolean> {
  const r = await db.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    args: [name],
  });
  return r.rows.length > 0;
}

export const migration: Migration = {
  id: '0004_add_jobs',
  description: 'Create GenerationJob table for live progress on long-running operations.',
  async up(db) {
    if (await tableExists(db, 'GenerationJob')) return;
    await db.execute(`
      CREATE TABLE GenerationJob (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
        totalItems INTEGER NOT NULL DEFAULT 0,
        processedItems INTEGER NOT NULL DEFAULT 0,
        currentLabel TEXT,
        startedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completedAt DATETIME,
        error TEXT,
        metadataJson TEXT,
        CONSTRAINT GenerationJob_user_fk FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
      )
    `);
    await db.execute(
      'CREATE INDEX GenerationJob_userId_status_idx ON GenerationJob(userId, status)'
    );
    await db.execute(
      'CREATE INDEX GenerationJob_userId_startedAt_idx ON GenerationJob(userId, startedAt)'
    );
    console.log('  created GenerationJob');
  },
};
