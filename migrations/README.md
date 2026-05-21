# Migrations

Numbered, forward-only schema migrations for the libSQL/Turso DB.

## Why this exists

We don't use `prisma migrate` — the libSQL adapter doesn't support its shadow-DB step, and Prisma's deploy mode is too opaque for the kind of table rebuilds SQLite occasionally needs (e.g. relaxing a `NOT NULL`). Hand-written `db.execute()` / `db.batch()` migrations are the path of least surprise.

This directory replaces the historical `scripts/migrate-*.ts` pattern, which had no tracking — every script tried to be idempotent on its own and we had no audit of what had been applied where.

## Day-to-day

```bash
npm run db:migrate           # apply all pending
npm run db:migrate:list      # show ✓/○ status of every migration
```

The runner keeps a `_migrations` table in the DB. Each row records the migration `id` (= filename without `.ts`) and `applied_at`.

## Adding a new migration

1. Create `NNNN_short_snake_case.ts` where `NNNN` is the next 4-digit ordinal.
2. Copy the template below.
3. Run `npm run db:migrate` — the runner picks it up automatically.

```ts
// migrations/0012_add_my_thing.ts
import type { Migration } from './_runner';

export const migration: Migration = {
  id: '0012_add_my_thing',
  description: 'Add MyThing table and its indexes.',
  async up(db) {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS MyThing (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(`CREATE INDEX IF NOT EXISTS MyThing_userId_idx ON MyThing(userId)`);
  },
};
```

Rules:

- **Filename and `id` must match exactly.** The runner asserts it.
- **Forward-only.** No `down()`. If you need to revert, write a new migration that undoes it.
- **Idempotent at the SQL level** even though the ledger guarantees one-shot execution. `CREATE TABLE IF NOT EXISTS`, `PRAGMA table_info` checks before `ALTER TABLE ADD COLUMN`, etc. Re-running a migration by mistake (or against a partially-rebuilt DB) should be a no-op, not a crash.
- **Multi-statement, atomic changes** use `db.batch([...], 'deferred')` — libSQL's HTTP driver doesn't keep transaction state across separate `db.execute()` calls, so `BEGIN` + `COMMIT` issued as separate executes will silently auto-commit each statement. Anything that has to either fully succeed or leave the table untouched (e.g. table rebuilds for `NOT NULL` relaxation) must go through `batch`.

## Adopting on an existing DB

Run once, exactly once, against a DB that was set up via the old `scripts/migrate-*.ts` files:

```bash
npm run db:migrate:baseline
```

This populates `_migrations` with every file currently in this directory, **without** executing any `up()`. Subsequent `npm run db:migrate` then only runs migrations whose files were added after the baseline.

If you instead run plain `npm run db:migrate` on an old DB, that also works — every historical migration is idempotent at the SQL level, so they'll all execute and be no-ops, ending up in the ledger the same way. `--baseline` just skips that detour.

## What lived here before this folder existed

Eleven hand-rolled scripts under `scripts/migrate-*.ts`. They were renamed and given `NNNN_` prefixes when this system landed (Apr 2026):

| Old file                              | New file                                          |
|---------------------------------------|---------------------------------------------------|
| `scripts/migrate-turso.ts`            | `0001_initial_schema.ts`                          |
| `scripts/migrate-automation.ts`       | `0002_add_automation.ts`                          |
| `scripts/migrate-campaign.ts`         | `0003_add_campaign.ts`                            |
| `scripts/migrate-jobs.ts`             | `0004_add_jobs.ts`                                |
| `scripts/migrate-ai-detection.ts`     | `0005_add_ai_detection.ts`                        |
| `scripts/migrate-ai-filter.ts`        | `0006_add_ai_filter.ts`                           |
| `scripts/migrate-job-heartbeat.ts`    | `0007_add_job_heartbeat.ts`                       |
| `scripts/migrate-job-details.ts`      | `0008_add_job_details.ts`                         |
| `scripts/migrate-clients-followups.ts`| `0009_add_clients_followups.ts`                   |
| `scripts/migrate-onboarding.ts`       | `0010_add_onboarding.ts`                          |
| `scripts/migrate-linkedin-channel.ts` + `scripts/migrate-linkedin-subject-nullable.ts` | `0011_linkedin_channel.ts` |
