/**
 * Create SavedSearch (reusable search recipes) and CampaignDay (one row per
 * scheduled outbound date, pinning a recipe + caps).
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
  id: '0003_add_campaign',
  description: 'Create SavedSearch (recipe library) and CampaignDay (daily schedule).',
  async up(db) {
    if (!(await tableExists(db, 'SavedSearch'))) {
      await db.execute(`
        CREATE TABLE SavedSearch (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('companies', 'people')),
          filtersJson TEXT NOT NULL,
          defaultDailyCap INTEGER NOT NULL DEFAULT 25,
          isBuiltIn INTEGER NOT NULL DEFAULT 0,
          createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT SavedSearch_user_fk FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
        )
      `);
      await db.execute(
        'CREATE UNIQUE INDEX SavedSearch_userId_code_key ON SavedSearch(userId, code)'
      );
      await db.execute('CREATE INDEX SavedSearch_userId_idx ON SavedSearch(userId)');
      console.log('  created SavedSearch');
    }

    if (!(await tableExists(db, 'CampaignDay'))) {
      await db.execute(`
        CREATE TABLE CampaignDay (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          scheduledDate TEXT NOT NULL,
          savedSearchId TEXT,
          dailyImportCap INTEGER NOT NULL DEFAULT 25,
          dailySendCap INTEGER NOT NULL DEFAULT 25,
          focusNote TEXT,
          status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'skipped', 'completed')),
          ranAt DATETIME,
          outcomeSummary TEXT,
          createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT CampaignDay_user_fk FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE,
          CONSTRAINT CampaignDay_ss_fk FOREIGN KEY (savedSearchId) REFERENCES SavedSearch(id) ON DELETE SET NULL
        )
      `);
      await db.execute(
        'CREATE UNIQUE INDEX CampaignDay_userId_date_key ON CampaignDay(userId, scheduledDate)'
      );
      await db.execute(
        'CREATE INDEX CampaignDay_userId_status_idx ON CampaignDay(userId, status)'
      );
      await db.execute(
        'CREATE INDEX CampaignDay_userId_date_idx ON CampaignDay(userId, scheduledDate)'
      );
      console.log('  created CampaignDay');
    }
  },
};
