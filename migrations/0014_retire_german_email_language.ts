/**
 * Retire German ('de') as an email/report output language.
 *
 * Why: as of June 2026 the campaign no longer generates German emails, reports,
 * or signatures — DACH companies get the full English treatment (only the
 * report's example money figure is still converted to EUR by the publish
 * pipeline). The code paths that produced 'de' were removed (inferLanguage,
 * lib/signatures, prompts/email-inline-report-de.md), so any 'de' left on a row
 * is dead data: FollowUpEmail inherits the parent Email's language at
 * generation time, which would have produced German follow-ups on the 16
 * already-sent German threads. Flipping those rows to 'en' makes every future
 * follow-up (body + signature) English with no legacy special-cases.
 *
 * Forward-only and idempotent: re-running matches zero rows.
 */
import type { Migration } from './_runner';

export const migration: Migration = {
  id: '0014_retire_german_email_language',
  description:
    "Flip Email/FollowUpEmail language 'de' -> 'en' (German output retired; DACH gets English with EUR report figures).",
  async up(db) {
    const e = await db.execute(`UPDATE Email SET language = 'en' WHERE language = 'de'`);
    console.log(`  Email: ${e.rowsAffected} row(s) 'de' -> 'en'`);
    const f = await db.execute(`UPDATE FollowUpEmail SET language = 'en' WHERE language = 'de'`);
    console.log(`  FollowUpEmail: ${f.rowsAffected} row(s) 'de' -> 'en'`);
  },
};
