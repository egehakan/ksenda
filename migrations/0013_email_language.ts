/**
 * Email + FollowUpEmail carry a `language` ('en' | 'tr' | 'de').
 *
 * Why: the campaign now runs in three languages (Turkey ⇒ tr, Germany/
 * Switzerland ⇒ de, else en). The body is generated in that language, and the
 * HTML signature appended at SEND time must match: translated tagline + a
 * website link to egehakankaraagac.com/report/<lang>. A single account (ksenda
 * sends Turkish to Turkey AND English to UAE) can't carry one static signature,
 * so the language is stamped on the Email at generation (persist.cjs phaseb)
 * and read by both send paths (smtp.cjs, src/lib/services/email-sender.ts) to
 * pick the localized signature (lib/signatures).
 *
 * Existing rows backfill to 'en' (the column default). FollowUpEmail inherits
 * the parent Email's language at generation time.
 */
import type { Client } from '@libsql/client';
import type { Migration } from './_runner';

async function columnExists(db: Client, table: string, column: string): Promise<boolean> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row: unknown) => (row as { name: string }).name === column);
}

async function ensureLanguage(db: Client, table: string) {
  if (!(await columnExists(db, table, 'language'))) {
    await db.execute(
      `ALTER TABLE ${table} ADD COLUMN language TEXT NOT NULL DEFAULT 'en'`
    );
    console.log(`  added ${table}.language`);
  }
  await db.execute(
    `UPDATE ${table} SET language = 'en' WHERE language IS NULL OR language = ''`
  );
}

export const migration: Migration = {
  id: '0013_email_language',
  description:
    "Add language column ('en' | 'tr' | 'de') to Email + FollowUpEmail so the send path picks the localized HTML signature (translated tagline + /report/<lang> link).",
  async up(db) {
    await ensureLanguage(db, 'Email');
    await ensureLanguage(db, 'FollowUpEmail');
  },
};
