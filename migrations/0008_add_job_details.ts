/**
 * Create GenerationJobDetail — per-item progress events on a parent job
 * ("checking acme.com → no_ai", "generating email for Acme Inc"). Concurrent
 * inserts are safe; createdAt gives natural ordering.
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
  id: '0008_add_job_details',
  description: 'Create GenerationJobDetail for per-item progress events.',
  async up(db) {
    if (await tableExists(db, 'GenerationJobDetail')) return;
    await db.execute(`
      CREATE TABLE GenerationJobDetail (
        id TEXT PRIMARY KEY,
        jobId TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT GenerationJobDetail_job_fk FOREIGN KEY (jobId) REFERENCES GenerationJob(id) ON DELETE CASCADE
      )
    `);
    await db.execute(
      'CREATE INDEX GenerationJobDetail_jobId_createdAt_idx ON GenerationJobDetail(jobId, createdAt)'
    );
    console.log('  created GenerationJobDetail');
  },
};
