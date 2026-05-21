/**
 * Recipes + campaign days carry a `channel` ('email' | 'linkedin').
 *
 * Why: the LinkedIn channel ships for the manual search/generate/send flow,
 * but the automation surface (smart setup wizard, recipe library, campaign
 * calendar) is still email-only. Tagging recipes by channel lets:
 *   - smart setup propose LinkedIn-shaped recipes
 *   - the calendar carry two cards per active day when the user picks "both"
 *   - the auto-send pipeline filter out LinkedIn rows at query level
 *
 * Existing rows get backfilled to `channel = 'email'` (default).
 *
 * The CampaignDay unique constraint must change from `(userId, scheduledDate)`
 * to `(userId, scheduledDate, channel)` so two campaign rows can coexist on
 * the same date — one per channel. We swap the unique index via `db.batch`
 * (libSQL HTTP doesn't keep transaction state across separate execute()
 * calls — see migrations/README.md).
 */
import type { Client } from '@libsql/client';
import type { Migration } from './_runner';

async function columnExists(db: Client, table: string, column: string): Promise<boolean> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row: unknown) => (row as { name: string }).name === column);
}

async function indexExists(db: Client, name: string): Promise<boolean> {
  const r = await db.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
    args: [name],
  });
  return r.rows.length > 0;
}

async function ensureSavedSearchChannel(db: Client) {
  if (!(await columnExists(db, 'SavedSearch', 'channel'))) {
    await db.execute(
      `ALTER TABLE SavedSearch ADD COLUMN channel TEXT NOT NULL DEFAULT 'email'`
    );
    console.log('  added SavedSearch.channel');
  }
  // Defensive backfill — column default should cover this, but if an older
  // ALTER happened with NULL allowed somewhere, normalize.
  await db.execute(
    `UPDATE SavedSearch SET channel = 'email' WHERE channel IS NULL OR channel = ''`
  );
}

async function ensureCampaignDayChannelAndIndex(db: Client) {
  if (!(await columnExists(db, 'CampaignDay', 'channel'))) {
    await db.execute(
      `ALTER TABLE CampaignDay ADD COLUMN channel TEXT NOT NULL DEFAULT 'email'`
    );
    console.log('  added CampaignDay.channel');
  }
  await db.execute(
    `UPDATE CampaignDay SET channel = 'email' WHERE channel IS NULL OR channel = ''`
  );

  // Swap the unique index. The old index may be named either
  // `CampaignDay_userId_scheduledDate_key` (Prisma's default naming) OR
  // `CampaignDay_userId_date_key` (the literal name our 0003_add_campaign
  // migration used). Drop whichever exists, then create the new one.
  const hasNew = await indexExists(
    db,
    'CampaignDay_userId_scheduledDate_channel_key'
  );
  const oldNames = [
    'CampaignDay_userId_scheduledDate_key',
    'CampaignDay_userId_date_key',
  ];
  const oldsPresent: string[] = [];
  for (const n of oldNames) {
    if (await indexExists(db, n)) oldsPresent.push(n);
  }

  if (oldsPresent.length > 0 && !hasNew) {
    await db.batch(
      [
        ...oldsPresent.map((n) => `DROP INDEX ${n}`),
        `CREATE UNIQUE INDEX CampaignDay_userId_scheduledDate_channel_key
         ON CampaignDay(userId, scheduledDate, channel)`,
      ],
      'deferred'
    );
    console.log(
      `  swapped CampaignDay unique index → (userId, scheduledDate, channel) (dropped: ${oldsPresent.join(', ')})`
    );
  } else if (oldsPresent.length > 0 && hasNew) {
    // Edge case: the new index already exists alongside the old (e.g.
    // 0012 ran before this patch and didn't clean the legacy name). Drop
    // the stragglers so the (userId, scheduledDate) constraint doesn't
    // still block per-channel duplicate rows.
    for (const n of oldsPresent) {
      await db.execute(`DROP INDEX ${n}`);
      console.log(`  dropped stale unique index ${n}`);
    }
  } else if (oldsPresent.length === 0 && !hasNew) {
    // Fresh DB path — no old index to drop, just create the new one.
    await db.execute(
      `CREATE UNIQUE INDEX CampaignDay_userId_scheduledDate_channel_key
       ON CampaignDay(userId, scheduledDate, channel)`
    );
    console.log(
      '  created CampaignDay unique index (userId, scheduledDate, channel)'
    );
  }
}

export const migration: Migration = {
  id: '0012_recipes_channel',
  description:
    "Add channel column ('email' | 'linkedin') to SavedSearch + CampaignDay. Swap CampaignDay unique key from (userId, scheduledDate) to (userId, scheduledDate, channel) so 'both' days can carry one row per channel.",
  async up(db) {
    await ensureSavedSearchChannel(db);
    await ensureCampaignDayChannelAndIndex(db);
  },
};
