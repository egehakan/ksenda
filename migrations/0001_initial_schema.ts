/**
 * Multi-tenant migration. Wraps the old `scripts/migrate-turso.ts`.
 *
 * Adds the User table (and the verification columns on existing User tables),
 * creates a default user, recreates Company / Prompt / TargetTitle /
 * FetchedOrganization / AuditLog with a userId column + compound uniques,
 * and drops the legacy Settings table.
 */
import type { Client } from '@libsql/client';
import bcrypt from 'bcryptjs';
import type { Migration } from './_runner';

const DEFAULT_USER_EMAIL = process.env.DEFAULT_USER_EMAIL || 'hakan@Ksendaai.com';
const DEFAULT_USER_PASSWORD = process.env.DEFAULT_USER_PASSWORD || 'Ksenda99.';

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

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

async function ensureUserTable(db: Client) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS User (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      name TEXT,
      companyName TEXT,
      companyWebsite TEXT,
      apolloApiKey TEXT,
      geminiApiKey TEXT,
      smtpProvider TEXT,
      smtpHost TEXT,
      smtpPort INTEGER,
      smtpSecure INTEGER,
      smtpUser TEXT,
      smtpPassword TEXT,
      senderEmail TEXT,
      senderName TEXT,
      signature TEXT,
      emailVerifiedAt DATETIME,
      verifyToken TEXT,
      verifyTokenExpiresAt DATETIME,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  for (const col of [
    { name: 'emailVerifiedAt', def: 'DATETIME' },
    { name: 'verifyToken', def: 'TEXT' },
    { name: 'verifyTokenExpiresAt', def: 'DATETIME' },
  ]) {
    if (!(await columnExists(db, 'User', col.name))) {
      await db.execute(`ALTER TABLE User ADD COLUMN ${col.name} ${col.def}`);
      console.log(`  added User.${col.name}`);
    }
  }
}

async function ensureDefaultUser(db: Client): Promise<string> {
  const existing = await db.execute({
    sql: 'SELECT id FROM User WHERE email = ? LIMIT 1',
    args: [DEFAULT_USER_EMAIL],
  });
  if (existing.rows.length > 0) {
    return (existing.rows[0] as unknown as { id: string }).id;
  }

  const id = makeId('usr');
  const passwordHash = await bcrypt.hash(DEFAULT_USER_PASSWORD, 10);

  let senderEmail: string | null = null;
  let senderName: string | null = null;
  let signature: string | null = null;
  if (await tableExists(db, 'Settings')) {
    const s = await db.execute(
      "SELECT senderEmail, senderName, signature FROM Settings WHERE id='default'"
    );
    if (s.rows.length) {
      const row = s.rows[0] as { senderEmail?: string; senderName?: string; signature?: string };
      senderEmail = row.senderEmail || null;
      senderName = row.senderName || null;
      signature = row.signature || null;
    }
  }

  await db.execute({
    sql: `INSERT INTO User (id, email, passwordHash, name, companyName, companyWebsite, senderEmail, senderName, signature, emailVerifiedAt, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    args: [
      id,
      DEFAULT_USER_EMAIL,
      passwordHash,
      'Admin',
      'Ksenda',
      'https://Ksendaai.com',
      senderEmail,
      senderName,
      signature,
    ],
  });
  console.log(`  created default user ${DEFAULT_USER_EMAIL}`);
  return id;
}

async function backfillEmailVerifiedAt(db: Client) {
  if (!(await columnExists(db, 'User', 'emailVerifiedAt'))) return;
  const r = await db.execute(
    "UPDATE User SET emailVerifiedAt = CURRENT_TIMESTAMP WHERE emailVerifiedAt IS NULL"
  );
  if (r.rowsAffected > 0) {
    console.log(`  backfilled emailVerifiedAt on ${r.rowsAffected} legacy row(s)`);
  }
}

async function backfillUserIdColumn(db: Client, table: string, defaultUserId: string) {
  if (!(await tableExists(db, table))) return;
  if (!(await columnExists(db, table, 'userId'))) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN userId TEXT`);
    console.log(`  added userId column to ${table}`);
  }
  await db.execute({
    sql: `UPDATE ${table} SET userId = ? WHERE userId IS NULL OR userId = ''`,
    args: [defaultUserId],
  });
}

async function recreatePromptTable(db: Client, defaultUserId: string) {
  if (!(await tableExists(db, 'Prompt'))) return;
  const idxList = await db.execute("PRAGMA index_list('Prompt')");
  const hasCompoundUnique = idxList.rows.some((row: unknown) => {
    const n = (row as { name?: string }).name;
    return typeof n === 'string' && (n.includes('userId') || n.includes('Prompt_userId_name'));
  });
  if (hasCompoundUnique) return;

  await db.execute('PRAGMA foreign_keys=OFF');
  await db.execute(`
    CREATE TABLE Prompt_new (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      description TEXT,
      isSystem INTEGER NOT NULL DEFAULT 0,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT Prompt_user_fk FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    )
  `);
  await db.execute(`
    INSERT INTO Prompt_new (id, userId, name, content, description, isSystem, isActive, createdAt, updatedAt)
    SELECT id, COALESCE(userId, '${defaultUserId}'), name, content, description, COALESCE(isSystem,0), COALESCE(isActive,1), createdAt, updatedAt
    FROM Prompt
  `);
  await db.execute('DROP TABLE Prompt');
  await db.execute('ALTER TABLE Prompt_new RENAME TO Prompt');
  await db.execute('CREATE UNIQUE INDEX Prompt_userId_name_key ON Prompt(userId, name)');
  await db.execute('CREATE INDEX Prompt_userId_idx ON Prompt(userId)');
  await db.execute('PRAGMA foreign_keys=ON');
  console.log('  recreated Prompt with (userId, name) unique');
}

async function recreateTargetTitleTable(db: Client, defaultUserId: string) {
  if (!(await tableExists(db, 'TargetTitle'))) return;
  const idxList = await db.execute("PRAGMA index_list('TargetTitle')");
  const hasCompoundUnique = idxList.rows.some((row: unknown) => {
    const n = (row as { name?: string }).name;
    return typeof n === 'string' && n.includes('TargetTitle_userId_title');
  });
  if (hasCompoundUnique) return;

  await db.execute('PRAGMA foreign_keys=OFF');
  await db.execute(`
    CREATE TABLE TargetTitle_new (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      title TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT TargetTitle_user_fk FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    )
  `);
  await db.execute(`
    INSERT INTO TargetTitle_new (id, userId, title, priority, isActive, createdAt, updatedAt)
    SELECT id, COALESCE(userId, '${defaultUserId}'), title, COALESCE(priority,100), COALESCE(isActive,1), createdAt, updatedAt
    FROM TargetTitle
  `);
  await db.execute('DROP TABLE TargetTitle');
  await db.execute('ALTER TABLE TargetTitle_new RENAME TO TargetTitle');
  await db.execute('CREATE UNIQUE INDEX TargetTitle_userId_title_key ON TargetTitle(userId, title)');
  await db.execute('CREATE INDEX TargetTitle_userId_idx ON TargetTitle(userId)');
  await db.execute('CREATE INDEX TargetTitle_userId_isActive_idx ON TargetTitle(userId, isActive)');
  await db.execute('CREATE INDEX TargetTitle_userId_priority_idx ON TargetTitle(userId, priority)');
  await db.execute('PRAGMA foreign_keys=ON');
  console.log('  recreated TargetTitle with (userId, title) unique');
}

async function recreateFetchedOrgTable(db: Client, defaultUserId: string) {
  if (!(await tableExists(db, 'FetchedOrganization'))) return;
  const idxList = await db.execute("PRAGMA index_list('FetchedOrganization')");
  const hasCompoundUnique = idxList.rows.some((row: unknown) => {
    const n = (row as { name?: string }).name;
    return typeof n === 'string' && n.includes('FetchedOrganization_userId_apolloId');
  });
  if (hasCompoundUnique) return;

  await db.execute('PRAGMA foreign_keys=OFF');
  await db.execute(`
    CREATE TABLE FetchedOrganization_new (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      apolloId TEXT NOT NULL,
      domain TEXT,
      name TEXT,
      fetchedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT FetchedOrg_user_fk FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    )
  `);
  await db.execute(`
    INSERT INTO FetchedOrganization_new (id, userId, apolloId, domain, name, fetchedAt)
    SELECT id, COALESCE(userId, '${defaultUserId}'), apolloId, domain, name, fetchedAt
    FROM FetchedOrganization
  `);
  await db.execute('DROP TABLE FetchedOrganization');
  await db.execute('ALTER TABLE FetchedOrganization_new RENAME TO FetchedOrganization');
  await db.execute(
    'CREATE UNIQUE INDEX FetchedOrganization_userId_apolloId_key ON FetchedOrganization(userId, apolloId)'
  );
  await db.execute('CREATE INDEX FetchedOrganization_userId_idx ON FetchedOrganization(userId)');
  await db.execute(
    'CREATE INDEX FetchedOrganization_userId_domain_idx ON FetchedOrganization(userId, domain)'
  );
  await db.execute('PRAGMA foreign_keys=ON');
  console.log('  recreated FetchedOrganization with (userId, apolloId) unique');
}

async function recreateCompanyTable(db: Client, defaultUserId: string) {
  if (!(await tableExists(db, 'Company'))) return;
  const idxList = await db.execute("PRAGMA index_list('Company')");
  const hasCompoundUnique = idxList.rows.some((row: unknown) => {
    const n = (row as { name?: string }).name;
    return typeof n === 'string' && n.includes('Company_userId_apolloId');
  });
  if (hasCompoundUnique) return;

  await db.execute('PRAGMA foreign_keys=OFF');
  await db.execute(`
    CREATE TABLE Company_new (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      apolloId TEXT,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      website TEXT,
      industry TEXT,
      location TEXT,
      employeeCount INTEGER,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      targetContactFirstName TEXT,
      targetContactLastName TEXT,
      targetContactEmail TEXT,
      targetContactTitle TEXT,
      contactFoundAt DATETIME,
      pipelineState TEXT NOT NULL DEFAULT 'pending_generation',
      notGeneratedReason JSONB,
      CONSTRAINT Company_user_fk FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    )
  `);

  const cols = await db.execute("PRAGMA table_info(Company)");
  const colNames = new Set(cols.rows.map((row: unknown) => (row as { name: string }).name));
  const has = (n: string) => colNames.has(n);

  await db.execute(`
    INSERT INTO Company_new (
      id, userId, apolloId, name, domain, website, industry, location, employeeCount,
      createdAt, updatedAt,
      targetContactFirstName, targetContactLastName, targetContactEmail, targetContactTitle, contactFoundAt,
      pipelineState, notGeneratedReason
    )
    SELECT
      id,
      COALESCE(userId, '${defaultUserId}'),
      ${has('apolloId') ? 'apolloId' : 'NULL'},
      name,
      domain,
      ${has('website') ? 'website' : 'NULL'},
      ${has('industry') ? 'industry' : 'NULL'},
      ${has('location') ? 'location' : 'NULL'},
      ${has('employeeCount') ? 'employeeCount' : 'NULL'},
      ${has('createdAt') ? 'createdAt' : 'CURRENT_TIMESTAMP'},
      ${has('updatedAt') ? 'updatedAt' : 'CURRENT_TIMESTAMP'},
      ${has('targetContactFirstName') ? 'targetContactFirstName' : 'NULL'},
      ${has('targetContactLastName') ? 'targetContactLastName' : 'NULL'},
      ${has('targetContactEmail') ? 'targetContactEmail' : 'NULL'},
      ${has('targetContactTitle') ? 'targetContactTitle' : 'NULL'},
      ${has('contactFoundAt') ? 'contactFoundAt' : 'NULL'},
      ${has('pipelineState') ? 'pipelineState' : "'pending_generation'"},
      ${has('notGeneratedReason') ? 'notGeneratedReason' : 'NULL'}
    FROM Company
  `);
  await db.execute('DROP TABLE Company');
  await db.execute('ALTER TABLE Company_new RENAME TO Company');
  await db.execute('CREATE UNIQUE INDEX Company_userId_apolloId_key ON Company(userId, apolloId)');
  await db.execute('CREATE INDEX Company_userId_idx ON Company(userId)');
  await db.execute(
    'CREATE INDEX Company_userId_pipelineState_idx ON Company(userId, pipelineState)'
  );
  await db.execute('PRAGMA foreign_keys=ON');
  console.log('  recreated Company with (userId, apolloId) unique');
}

async function recreateAuditLogTable(db: Client, defaultUserId: string) {
  if (!(await tableExists(db, 'AuditLog'))) return;
  const idxList = await db.execute("PRAGMA index_list('AuditLog')");
  const hasUserIndex = idxList.rows.some((row: unknown) => {
    const n = (row as { name?: string }).name;
    return typeof n === 'string' && n.includes('AuditLog_userId');
  });
  if (hasUserIndex) return;

  await db.execute('PRAGMA foreign_keys=OFF');
  await db.execute(`
    CREATE TABLE AuditLog_new (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      entityType TEXT NOT NULL,
      entityId TEXT NOT NULL,
      action TEXT NOT NULL,
      fromState TEXT,
      toState TEXT,
      metadata JSONB,
      performedBy TEXT,
      performedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT AuditLog_user_fk FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    )
  `);
  await db.execute(`
    INSERT INTO AuditLog_new (id, userId, entityType, entityId, action, fromState, toState, metadata, performedBy, performedAt)
    SELECT id, COALESCE(userId, '${defaultUserId}'), entityType, entityId, action, fromState, toState, metadata, performedBy, performedAt
    FROM AuditLog
  `);
  await db.execute('DROP TABLE AuditLog');
  await db.execute('ALTER TABLE AuditLog_new RENAME TO AuditLog');
  await db.execute('CREATE INDEX AuditLog_userId_idx ON AuditLog(userId)');
  await db.execute(
    'CREATE INDEX AuditLog_userId_entityType_entityId_idx ON AuditLog(userId, entityType, entityId)'
  );
  await db.execute(
    'CREATE INDEX AuditLog_userId_performedAt_idx ON AuditLog(userId, performedAt)'
  );
  await db.execute('PRAGMA foreign_keys=ON');
  console.log('  recreated AuditLog with userId');
}

async function dropLegacySettingsTable(db: Client) {
  if (!(await tableExists(db, 'Settings'))) return;
  await db.execute('DROP TABLE Settings');
  console.log('  dropped legacy Settings table');
}

export const migration: Migration = {
  id: '0001_initial_schema',
  description: 'Multi-tenant baseline: User + default user + per-table userId backfill + Settings cleanup',
  async up(db) {
    await ensureUserTable(db);
    const defaultUserId = await ensureDefaultUser(db);
    await backfillEmailVerifiedAt(db);

    for (const t of ['Company', 'Prompt', 'TargetTitle', 'FetchedOrganization', 'AuditLog']) {
      await backfillUserIdColumn(db, t, defaultUserId);
    }

    await recreateCompanyTable(db, defaultUserId);
    await recreatePromptTable(db, defaultUserId);
    await recreateTargetTitleTable(db, defaultUserId);
    await recreateFetchedOrgTable(db, defaultUserId);
    await recreateAuditLogTable(db, defaultUserId);

    await dropLegacySettingsTable(db);
  },
};
