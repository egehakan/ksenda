/**
 * LinkedIn channel support. Combines what used to be two separate scripts:
 *
 *   1. Column additions + index swaps
 *      - Company.targetContactLinkedinUrl
 *      - Email.channel, FollowUpEmail.channel (default 'email')
 *      - Prompt.platform, FollowUpPrompt.platform (default 'email')
 *      - Recreated unique indexes to include platform
 *      - Seeded 4 LinkedIn prompts (initial + 3 follow-ups) for every user
 *
 *   2. Relaxing subject NOT NULL on Email and FollowUpEmail. SQLite can't
 *      ALTER COLUMN nullability, so we rebuild each table via the standard
 *      CREATE _new + INSERT … SELECT * + DROP + RENAME dance. Run inside
 *      `db.batch(…, 'deferred')` because libSQL HTTP doesn't keep transaction
 *      state across separate execute() calls.
 */
import type { Client } from '@libsql/client';
import { randomBytes } from 'crypto';
import {
  DEFAULT_LINKEDIN_INITIAL_PROMPT,
  DEFAULT_LINKEDIN_FOLLOWUP_PROMPTS,
} from '../src/lib/constants';
import type { Migration } from './_runner';

const cuid = () => 'cm' + randomBytes(12).toString('hex');

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

async function tableExists(db: Client, name: string): Promise<boolean> {
  const r = await db.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    args: [name],
  });
  return r.rows.length > 0;
}

async function subjectIsNullable(
  db: Client,
  table: 'Email' | 'FollowUpEmail'
): Promise<boolean> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  const subjectRow = r.rows.find(
    (row: unknown) => (row as { name: string }).name === 'subject'
  ) as { notnull: number | bigint } | undefined;
  if (!subjectRow) throw new Error(`${table}.subject column not found`);
  const n =
    typeof subjectRow.notnull === 'bigint'
      ? Number(subjectRow.notnull)
      : subjectRow.notnull;
  return n === 0;
}

async function countRows(db: Client, table: string): Promise<number> {
  const r = await db.execute(`SELECT COUNT(*) AS n FROM ${table}`);
  const v = (r.rows[0] as unknown as { n: number | bigint }).n;
  return typeof v === 'bigint' ? Number(v) : v;
}

// ────────────────────────────────────────────────────────────────────────
// Stage 1: simple ADD COLUMN + index swaps
// ────────────────────────────────────────────────────────────────────────

async function ensureCompanyLinkedinUrl(db: Client) {
  if (!(await columnExists(db, 'Company', 'targetContactLinkedinUrl'))) {
    await db.execute(`ALTER TABLE Company ADD COLUMN targetContactLinkedinUrl TEXT`);
    console.log('  added Company.targetContactLinkedinUrl');
  }
}

async function ensureEmailChannel(db: Client) {
  if (!(await columnExists(db, 'Email', 'channel'))) {
    await db.execute(`ALTER TABLE Email ADD COLUMN channel TEXT NOT NULL DEFAULT 'email'`);
    console.log('  added Email.channel');
  }
}

async function ensureFollowUpEmailChannel(db: Client) {
  if (!(await columnExists(db, 'FollowUpEmail', 'channel'))) {
    await db.execute(
      `ALTER TABLE FollowUpEmail ADD COLUMN channel TEXT NOT NULL DEFAULT 'email'`
    );
    console.log('  added FollowUpEmail.channel');
  }
}

async function ensurePromptPlatform(db: Client) {
  if (!(await columnExists(db, 'Prompt', 'platform'))) {
    await db.execute(`ALTER TABLE Prompt ADD COLUMN platform TEXT NOT NULL DEFAULT 'email'`);
    console.log('  added Prompt.platform');
  }
  await db.execute(
    `UPDATE Prompt SET platform = 'email' WHERE platform IS NULL OR platform = ''`
  );

  if (await indexExists(db, 'Prompt_userId_name_key')) {
    await db.execute(`DROP INDEX Prompt_userId_name_key`);
    console.log('  dropped Prompt(userId, name) unique index');
  }
  if (!(await indexExists(db, 'Prompt_userId_name_platform_key'))) {
    await db.execute(
      `CREATE UNIQUE INDEX Prompt_userId_name_platform_key ON Prompt(userId, name, platform)`
    );
    console.log('  created Prompt(userId, name, platform) unique index');
  }
}

async function ensureFollowUpPromptPlatform(db: Client) {
  if (!(await columnExists(db, 'FollowUpPrompt', 'platform'))) {
    await db.execute(
      `ALTER TABLE FollowUpPrompt ADD COLUMN platform TEXT NOT NULL DEFAULT 'email'`
    );
    console.log('  added FollowUpPrompt.platform');
  }
  await db.execute(
    `UPDATE FollowUpPrompt SET platform = 'email' WHERE platform IS NULL OR platform = ''`
  );

  if (await indexExists(db, 'FollowUpPrompt_userId_step_key')) {
    await db.execute(`DROP INDEX FollowUpPrompt_userId_step_key`);
    console.log('  dropped FollowUpPrompt(userId, step) unique index');
  }
  if (!(await indexExists(db, 'FollowUpPrompt_userId_step_platform_key'))) {
    await db.execute(
      `CREATE UNIQUE INDEX FollowUpPrompt_userId_step_platform_key ON FollowUpPrompt(userId, step, platform)`
    );
    console.log('  created FollowUpPrompt(userId, step, platform) unique index');
  }
}

async function seedLinkedInPromptsForAllUsers(db: Client) {
  const users = await db.execute('SELECT id, email FROM User');
  for (const row of users.rows) {
    const user = row as unknown as { id: string; email: string };

    const existingInitial = await db.execute({
      sql: `SELECT id FROM Prompt WHERE userId = ? AND name = 'active_prompt' AND platform = 'linkedin'`,
      args: [user.id],
    });
    if (existingInitial.rows.length === 0) {
      await db.execute({
        sql: `INSERT INTO Prompt (id, userId, name, content, description, isSystem, isActive, platform, createdAt, updatedAt)
              VALUES (?, ?, 'active_prompt', ?, 'Active LinkedIn cold-message prompt', 0, 1, 'linkedin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        args: [cuid(), user.id, DEFAULT_LINKEDIN_INITIAL_PROMPT],
      });
      console.log(`  seeded LinkedIn initial prompt for ${user.email}`);
    }

    for (const p of DEFAULT_LINKEDIN_FOLLOWUP_PROMPTS) {
      const existing = await db.execute({
        sql: `SELECT id FROM FollowUpPrompt WHERE userId = ? AND step = ? AND platform = 'linkedin'`,
        args: [user.id, p.step],
      });
      if (existing.rows.length === 0) {
        await db.execute({
          sql: `INSERT INTO FollowUpPrompt (id, userId, step, dayOffset, name, content, isActive, platform, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, 1, 'linkedin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          args: [cuid(), user.id, p.step, p.dayOffset, p.name, p.content],
        });
        console.log(`  seeded LinkedIn follow-up step ${p.step} for ${user.email}`);
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Stage 2: rebuild Email and FollowUpEmail so subject is nullable
// ────────────────────────────────────────────────────────────────────────

async function rebuildEmail(db: Client) {
  if (await subjectIsNullable(db, 'Email')) return;
  const before = await countRows(db, 'Email');
  console.log(`  Email rebuild · ${before} rows`);

  if (await tableExists(db, 'Email_new')) {
    await db.execute(`DROP TABLE Email_new`);
  }

  await db.batch(
    [
      `CREATE TABLE Email_new (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        promptUsed TEXT NOT NULL,
        subject TEXT,
        body TEXT NOT NULL,
        generatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        geminiModelUsed TEXT,
        editedSubject TEXT,
        editedBody TEXT,
        reviewedAt DATETIME,
        reviewedBy TEXT,
        finalSubject TEXT,
        finalBody TEXT,
        approvedAt DATETIME,
        approvedBy TEXT,
        sentAt DATETIME,
        sentTo TEXT,
        sendError TEXT,
        sendAttempts INTEGER NOT NULL DEFAULT 0,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL,
        messageId TEXT,
        channel TEXT NOT NULL DEFAULT 'email',
        CONSTRAINT Email_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company(id) ON DELETE CASCADE
      )`,
      `INSERT INTO Email_new (
        id, companyId, promptUsed, subject, body, generatedAt, geminiModelUsed,
        editedSubject, editedBody, reviewedAt, reviewedBy,
        finalSubject, finalBody, approvedAt, approvedBy,
        sentAt, sentTo, sendError, sendAttempts,
        createdAt, updatedAt, messageId, channel
      )
      SELECT
        id, companyId, promptUsed, subject, body, generatedAt, geminiModelUsed,
        editedSubject, editedBody, reviewedAt, reviewedBy,
        finalSubject, finalBody, approvedAt, approvedBy,
        sentAt, sentTo, sendError, sendAttempts,
        createdAt, updatedAt, messageId, channel
      FROM Email`,
      `DROP TABLE Email`,
      `ALTER TABLE Email_new RENAME TO Email`,
      `CREATE UNIQUE INDEX Email_companyId_key ON Email(companyId)`,
    ],
    'deferred'
  );

  const after = await countRows(db, 'Email');
  if (after !== before) {
    throw new Error(`Email row count drifted during rebuild: ${before} → ${after}`);
  }
  console.log(`  Email rebuilt · subject now nullable · ${after} rows`);
}

async function rebuildFollowUpEmail(db: Client) {
  if (await subjectIsNullable(db, 'FollowUpEmail')) return;
  const before = await countRows(db, 'FollowUpEmail');
  console.log(`  FollowUpEmail rebuild · ${before} rows`);

  if (await tableExists(db, 'FollowUpEmail_new')) {
    await db.execute(`DROP TABLE FollowUpEmail_new`);
  }

  await db.batch(
    [
      `CREATE TABLE FollowUpEmail_new (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        step INTEGER NOT NULL,
        promptUsed TEXT NOT NULL,
        subject TEXT,
        body TEXT NOT NULL,
        generatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        geminiModelUsed TEXT,
        editedSubject TEXT,
        editedBody TEXT,
        reviewedAt DATETIME,
        reviewedBy TEXT,
        finalSubject TEXT,
        finalBody TEXT,
        approvedAt DATETIME,
        approvedBy TEXT,
        sentAt DATETIME,
        sentTo TEXT,
        sendError TEXT,
        sendAttempts INTEGER NOT NULL DEFAULT 0,
        threadMessageId TEXT,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        channel TEXT NOT NULL DEFAULT 'email',
        CONSTRAINT FollowUpEmail_companyId_fkey FOREIGN KEY (companyId) REFERENCES Company(id) ON DELETE CASCADE
      )`,
      `INSERT INTO FollowUpEmail_new (
        id, companyId, step, promptUsed, subject, body,
        generatedAt, geminiModelUsed,
        editedSubject, editedBody, reviewedAt, reviewedBy,
        finalSubject, finalBody, approvedAt, approvedBy,
        sentAt, sentTo, sendError, sendAttempts,
        threadMessageId, createdAt, updatedAt, channel
      )
      SELECT
        id, companyId, step, promptUsed, subject, body,
        generatedAt, geminiModelUsed,
        editedSubject, editedBody, reviewedAt, reviewedBy,
        finalSubject, finalBody, approvedAt, approvedBy,
        sentAt, sentTo, sendError, sendAttempts,
        threadMessageId, createdAt, updatedAt, channel
      FROM FollowUpEmail`,
      `DROP TABLE FollowUpEmail`,
      `ALTER TABLE FollowUpEmail_new RENAME TO FollowUpEmail`,
      `CREATE INDEX FollowUpEmail_companyId_idx ON FollowUpEmail(companyId)`,
      `CREATE INDEX FollowUpEmail_companyId_step_idx ON FollowUpEmail(companyId, step)`,
    ],
    'deferred'
  );

  const after = await countRows(db, 'FollowUpEmail');
  if (after !== before) {
    throw new Error(
      `FollowUpEmail row count drifted during rebuild: ${before} → ${after}`
    );
  }
  console.log(`  FollowUpEmail rebuilt · subject now nullable · ${after} rows`);
}

export const migration: Migration = {
  id: '0011_linkedin_channel',
  description:
    'LinkedIn channel: add Company.targetContactLinkedinUrl, channel/platform fields, swap unique indexes, seed LinkedIn prompts, relax subject NOT NULL on Email + FollowUpEmail.',
  async up(db) {
    await ensureCompanyLinkedinUrl(db);
    await ensureEmailChannel(db);
    await ensureFollowUpEmailChannel(db);
    await ensurePromptPlatform(db);
    await ensureFollowUpPromptPlatform(db);
    await seedLinkedInPromptsForAllUsers(db);
    await rebuildEmail(db);
    await rebuildFollowUpEmail(db);
  },
};
