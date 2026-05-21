/**
 * Add onboarding state to User. Pre-existing verified users are backfilled
 * with `onboardingCompletedAt = createdAt` so they skip the flow.
 */
import type { Client } from '@libsql/client';
import type { Migration } from './_runner';

async function columnExists(db: Client, table: string, column: string): Promise<boolean> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row: unknown) => (row as { name: string }).name === column);
}

const COLUMNS: Array<{ name: string; def: string }> = [
  { name: 'onboardingStep', def: 'TEXT' },
  { name: 'onboardingCompletedAt', def: 'DATETIME' },
];

export const migration: Migration = {
  id: '0010_add_onboarding',
  description: 'Add User.onboardingStep / onboardingCompletedAt; backfill existing verified users.',
  async up(db) {
    for (const c of COLUMNS) {
      if (!(await columnExists(db, 'User', c.name))) {
        await db.execute(`ALTER TABLE User ADD COLUMN ${c.name} ${c.def}`);
        console.log(`  added User.${c.name}`);
      }
    }
    const r = await db.execute(
      "UPDATE User SET onboardingCompletedAt = COALESCE(createdAt, CURRENT_TIMESTAMP) WHERE onboardingCompletedAt IS NULL AND emailVerifiedAt IS NOT NULL"
    );
    if (r.rowsAffected > 0) {
      console.log(`  backfilled onboardingCompletedAt for ${r.rowsAffected} legacy verified user(s)`);
    }
  },
};
