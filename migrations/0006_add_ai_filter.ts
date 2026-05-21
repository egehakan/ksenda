/**
 * Add SavedSearch.aiFilter — recipe-level "import only no-AI / only has-AI"
 * gating. Triggers the page-walk loop in the import service.
 */
import type { Client } from '@libsql/client';
import type { Migration } from './_runner';

async function columnExists(db: Client, table: string, column: string): Promise<boolean> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row: unknown) => (row as { name: string }).name === column);
}

export const migration: Migration = {
  id: '0006_add_ai_filter',
  description: "Add SavedSearch.aiFilter (default 'any') for recipe-level AI gating.",
  async up(db) {
    if (await columnExists(db, 'SavedSearch', 'aiFilter')) return;
    await db.execute(
      `ALTER TABLE SavedSearch ADD COLUMN aiFilter TEXT NOT NULL DEFAULT 'any'`
    );
    console.log("  added SavedSearch.aiFilter (default 'any')");
  },
};
