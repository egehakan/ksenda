/**
 * Add automation settings columns to User: the five toggles, daily caps,
 * working-hours window, saved search recipe, and last-run telemetry.
 */
import type { Client } from '@libsql/client';
import type { Migration } from './_runner';

async function columnExists(db: Client, table: string, column: string): Promise<boolean> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row: unknown) => (row as { name: string }).name === column);
}

const COLUMNS: Array<{ name: string; def: string }> = [
  { name: 'autoImportEnabled', def: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'autoApproveInitialDrafts', def: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'autoSendApprovedEmails', def: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'autoGenerateFollowUps', def: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'autoApproveFollowUps', def: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'dailyImportCap', def: 'INTEGER NOT NULL DEFAULT 25' },
  { name: 'dailySendCap', def: 'INTEGER NOT NULL DEFAULT 25' },
  { name: 'automationWindowStartHour', def: 'INTEGER NOT NULL DEFAULT 9' },
  { name: 'automationWindowEndHour', def: 'INTEGER NOT NULL DEFAULT 17' },
  { name: 'automationTimezone', def: "TEXT DEFAULT 'Europe/Istanbul'" },
  { name: 'savedSearchKind', def: 'TEXT' },
  { name: 'savedSearchFiltersJson', def: 'TEXT' },
  { name: 'automationLastRunAt', def: 'DATETIME' },
  { name: 'automationLastRunSummary', def: 'TEXT' },
];

export const migration: Migration = {
  id: '0002_add_automation',
  description: 'Add automation toggles, caps, working-hours window, saved-search recipe, last-run telemetry to User.',
  async up(db) {
    for (const c of COLUMNS) {
      if (!(await columnExists(db, 'User', c.name))) {
        await db.execute(`ALTER TABLE User ADD COLUMN ${c.name} ${c.def}`);
        console.log(`  added User.${c.name}`);
      }
    }
  },
};
