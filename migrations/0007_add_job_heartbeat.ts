/**
 * Add GenerationJob.lastHeartbeatAt so the reaper distinguishes "actively
 * progressing" from "abandoned" by recency-of-last-update, not start time.
 */
import type { Client } from '@libsql/client';
import type { Migration } from './_runner';

async function columnExists(db: Client, table: string, column: string): Promise<boolean> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row: unknown) => (row as { name: string }).name === column);
}

export const migration: Migration = {
  id: '0007_add_job_heartbeat',
  description: 'Add GenerationJob.lastHeartbeatAt (backfilled from startedAt) + index.',
  async up(db) {
    if (!(await columnExists(db, 'GenerationJob', 'lastHeartbeatAt'))) {
      await db.execute(`ALTER TABLE GenerationJob ADD COLUMN lastHeartbeatAt DATETIME`);
      await db.execute(
        `UPDATE GenerationJob SET lastHeartbeatAt = startedAt WHERE lastHeartbeatAt IS NULL`
      );
      console.log('  added GenerationJob.lastHeartbeatAt (backfilled)');
    }
    await db.execute(
      'CREATE INDEX IF NOT EXISTS GenerationJob_userId_lastHeartbeatAt_idx ON GenerationJob(userId, lastHeartbeatAt)'
    );
  },
};
