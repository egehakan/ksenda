/**
 * Clients tracking + follow-up automation.
 *
 *   - Adds Company columns for the client lifecycle (clientStatus,
 *     nextFollowUpAt, followUpStep, clientNote, isManual)
 *   - Creates FollowUpPrompt + FollowUpEmail tables
 *   - Adds Email.messageId so the first follow-up can be issued as a real
 *     in-thread reply
 *   - Seeds the three default email follow-up prompts for every existing
 *     user that doesn't have them
 */
import type { Client } from '@libsql/client';
import { randomBytes } from 'crypto';
import { DEFAULT_FOLLOWUP_PROMPTS } from '../src/lib/constants';
import type { Migration } from './_runner';

const cuid = () => 'cm' + randomBytes(12).toString('hex');

async function tableExists(db: Client, name: string): Promise<boolean> {
  const r = await db.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    args: [name],
  });
  return r.rows.length > 0;
}

async function columnExists(db: Client, table: string, column: string): Promise<boolean> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row: unknown) => (row as { name: string }).name === column);
}

async function ensureCompanyColumns(db: Client) {
  const additions: Array<{ name: string; def: string }> = [
    { name: 'clientStatus', def: 'TEXT' },
    { name: 'clientStatusUpdatedAt', def: 'DATETIME' },
    { name: 'clientNote', def: 'TEXT' },
    { name: 'nextFollowUpAt', def: 'DATETIME' },
    { name: 'followUpStep', def: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'isManual', def: 'INTEGER NOT NULL DEFAULT 0' },
  ];
  for (const c of additions) {
    if (!(await columnExists(db, 'Company', c.name))) {
      await db.execute(`ALTER TABLE Company ADD COLUMN ${c.name} ${c.def}`);
      console.log(`  added Company.${c.name}`);
    }
  }
  await db.execute(
    'CREATE INDEX IF NOT EXISTS Company_userId_clientStatus_idx ON Company(userId, clientStatus)'
  );
  await db.execute(
    'CREATE INDEX IF NOT EXISTS Company_userId_nextFollowUpAt_idx ON Company(userId, nextFollowUpAt)'
  );
}

async function ensureFollowUpPromptTable(db: Client) {
  if (await tableExists(db, 'FollowUpPrompt')) return;
  await db.execute(`
    CREATE TABLE FollowUpPrompt (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      step INTEGER NOT NULL,
      dayOffset INTEGER NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT FollowUpPrompt_user_fk FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    )
  `);
  await db.execute(
    'CREATE UNIQUE INDEX FollowUpPrompt_userId_step_key ON FollowUpPrompt(userId, step)'
  );
  await db.execute('CREATE INDEX FollowUpPrompt_userId_idx ON FollowUpPrompt(userId)');
  console.log('  created FollowUpPrompt');
}

async function ensureFollowUpEmailTable(db: Client) {
  if (await tableExists(db, 'FollowUpEmail')) return;
  await db.execute(`
    CREATE TABLE FollowUpEmail (
      id TEXT PRIMARY KEY,
      companyId TEXT NOT NULL,
      step INTEGER NOT NULL,

      promptUsed TEXT NOT NULL,
      subject TEXT NOT NULL,
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
      CONSTRAINT FollowUpEmail_company_fk FOREIGN KEY (companyId) REFERENCES Company(id) ON DELETE CASCADE
    )
  `);
  await db.execute('CREATE INDEX FollowUpEmail_companyId_idx ON FollowUpEmail(companyId)');
  await db.execute(
    'CREATE INDEX FollowUpEmail_companyId_step_idx ON FollowUpEmail(companyId, step)'
  );
  console.log('  created FollowUpEmail');
}

async function ensureEmailThreadingColumn(db: Client) {
  if (!(await columnExists(db, 'Email', 'messageId'))) {
    await db.execute(`ALTER TABLE Email ADD COLUMN messageId TEXT`);
    console.log('  added Email.messageId');
  }
}

async function seedFollowUpPromptsForAllUsers(db: Client) {
  const users = await db.execute('SELECT id, email FROM User');
  for (const row of users.rows) {
    const user = row as unknown as { id: string; email: string };
    for (const p of DEFAULT_FOLLOWUP_PROMPTS) {
      const existing = await db.execute({
        sql: 'SELECT id FROM FollowUpPrompt WHERE userId = ? AND step = ?',
        args: [user.id, p.step],
      });
      if (existing.rows.length === 0) {
        await db.execute({
          sql: `INSERT INTO FollowUpPrompt (id, userId, step, dayOffset, name, content, isActive, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          args: [cuid(), user.id, p.step, p.dayOffset, p.name, p.content],
        });
        console.log(`  seeded follow-up step ${p.step} for ${user.email}`);
      }
    }
  }
}

export const migration: Migration = {
  id: '0009_add_clients_followups',
  description: 'Client lifecycle columns + FollowUpPrompt/FollowUpEmail tables + Email.messageId + seed prompts.',
  async up(db) {
    await ensureCompanyColumns(db);
    await ensureFollowUpPromptTable(db);
    await ensureFollowUpEmailTable(db);
    await ensureEmailThreadingColumn(db);
    await seedFollowUpPromptsForAllUsers(db);
  },
};
