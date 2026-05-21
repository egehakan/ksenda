/**
 * AI-detection storage. Add per-Company denormalized fields and a per-user
 * domain cache so repeat detections don't burn Gemini credits.
 */
import type { Client } from '@libsql/client';
import type { Migration } from './_runner';

async function columnExists(db: Client, table: string, column: string): Promise<boolean> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row: unknown) => (row as { name: string }).name === column);
}

async function tableExists(db: Client, name: string): Promise<boolean> {
  const r = await db.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    args: [name],
  });
  return r.rows.length > 0;
}

export const migration: Migration = {
  id: '0005_add_ai_detection',
  description: 'Add Company AI-detection fields + AiDetectionCache table.',
  async up(db) {
    const cols = [
      { name: 'aiHasAi', ddl: 'ALTER TABLE Company ADD COLUMN aiHasAi INTEGER' },
      { name: 'aiStatusJson', ddl: 'ALTER TABLE Company ADD COLUMN aiStatusJson TEXT' },
      { name: 'aiCheckedAt', ddl: 'ALTER TABLE Company ADD COLUMN aiCheckedAt DATETIME' },
    ];
    for (const c of cols) {
      if (!(await columnExists(db, 'Company', c.name))) {
        await db.execute(c.ddl);
        console.log(`  added Company.${c.name}`);
      }
    }
    await db.execute(
      'CREATE INDEX IF NOT EXISTS Company_userId_aiHasAi_idx ON Company(userId, aiHasAi)'
    );

    if (!(await tableExists(db, 'AiDetectionCache'))) {
      await db.execute(`
        CREATE TABLE AiDetectionCache (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          domain TEXT NOT NULL,
          hasAi INTEGER NOT NULL,
          confidence TEXT NOT NULL,
          resultJson TEXT NOT NULL,
          checkedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT AiDetectionCache_user_fk FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
        )
      `);
      await db.execute(
        'CREATE UNIQUE INDEX AiDetectionCache_userId_domain_uq ON AiDetectionCache(userId, domain)'
      );
      await db.execute(
        'CREATE INDEX AiDetectionCache_userId_checkedAt_idx ON AiDetectionCache(userId, checkedAt)'
      );
      console.log('  created AiDetectionCache');
    }
  },
};
