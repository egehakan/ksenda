# Ksenda — agent guide

This file is for AI coding agents (Claude / Cursor / Codex) working in this repo. It captures conventions that aren't obvious from reading the source.

## Repo at a glance

- **Stack**: Next.js 16 App Router + React 19, Prisma 7 + libSQL (Turso), Tailwind 4, Inngest for background jobs, Zustand for client state, TanStack Query for server state.
- **Multi-tenant**: every meaningful row is scoped by `userId`. There is no global config — Apollo / Gemini / SMTP credentials live on the User row.
- **App entry**: `src/app/page.tsx` is the entire authenticated dashboard. Search, Pipeline, Clients, Prompts, Settings are tabs inside it.

## Database & migrations — read first

We do **not** use `prisma migrate`. We use a hand-written, numbered migration system in `/migrations`.

### Day-to-day

```bash
npm run db:migrate           # apply all pending migrations
npm run db:migrate:list      # show ✓/○ status of every migration
```

The runner reads from a `_migrations` ledger table on the DB to figure out what's pending.

### Adding a schema change

1. Create `migrations/NNNN_short_snake_case.ts` where NNNN is the next ordinal.
2. Export a `migration` object with `id`, `description`, and an async `up(db)` that takes a `Client` from `@libsql/client`.
3. Run `npm run db:migrate`.

Template and full rules: see [`migrations/README.md`](migrations/README.md).

### What this replaces

The old pattern was one-off `scripts/migrate-*.ts` files with no tracking — every script had to be idempotent on its own and there was no audit of what had been applied where. That pattern is **deprecated**. Do not add new files to `scripts/migrate-*.ts`.

### What NOT to do

- Don't run schema changes from `scripts/`. They go in `/migrations/`.
- Don't write a `down()`. The system is forward-only. If you need to revert, write a new migration that undoes it.
- Don't `BEGIN` / `COMMIT` across separate `db.execute()` calls — libSQL HTTP doesn't keep transaction state across requests, and each statement auto-commits. For atomic multi-statement changes (e.g. table rebuilds), use `db.batch([...], 'deferred')`.

## `scripts/` directory

Reserved for **long-lived operational utilities** that get re-run periodically: `seed-admin.ts`, `warmup-send.ts`, `recover-reaped-jobs.ts`, etc. See [`scripts/README.md`](scripts/README.md) for the full list and the rules on what does NOT belong there.

If you're tempted to write `scripts/check-X.ts` or `scripts/fix-Y.ts` to debug something or recover from an incident, **don't commit it**. Either:
- Make the fix itself in code (often a migration), and let the bad state be cleared by the user re-doing the action, OR
- Run your investigation in a throwaway shell and delete it when done.

The historical scripts folder grew to 60+ files of one-off debugging / content-update / asset-generation cruft. We are not doing that again.

## Other conventions

### State management

- **Server state** = TanStack Query. Always invalidate the relevant query keys after a mutation, e.g. `queryClient.invalidateQueries({ queryKey: ['companies'] })`.
- **Client state that should survive navigation** = Zustand with the `persist` middleware in `src/store/*-store.ts`. The channel toggle on the search pages is the canonical example.
- **Client state that's transient to one component** = `useState`.

### Background jobs

Long-running work (imports, follow-up generation, batch sends) runs through Inngest. The pattern:

1. A REST route (`/api/companies/import` etc.) accepts the request, creates a `GenerationJob` row, dispatches an Inngest event, and returns the `jobId` synchronously.
2. The Inngest function in `src/inngest/functions/*.ts` consumes the event and runs the actual work — calling into service functions in `src/lib/services/`.
3. The frontend polls `GET /api/jobs/[id]` and `GET /api/jobs/active`, surfaced through the bottom-right `JobProgressWidget`.

When adding a new long-running operation, mirror this shape.

### Apollo + Gemini API costs

These are real-money APIs running on the user's own keys. Two rules:

1. **Cache.** `AiDetectionCache` caches per-domain Gemini detection results. Reuse it before issuing a new call.
2. **Don't re-spend on retry.** The retry path in `processOneCompanyForGeneration` / `retryEmailGenerationForCompany` reuses the existing target contact on the Company row; it does NOT call `findBestContact` again. Preserve that.

### LinkedIn channel

The Email and FollowUpEmail models carry a `channel` field that's either `'email'` or `'linkedin'`. The LinkedIn channel:

- Stores `subject = NULL` (Email.subject is nullable on purpose).
- Uses `Company.targetContactLinkedinUrl` instead of `targetContactEmail` for the destination.
- Is **never sent via SMTP**. The user pastes the message into their own LinkedIn account manually via the `LinkedInSendModal`, which then hits `/api/{pipeline,followups}/{,batch-}mark-sent`.

The Prompt + FollowUpPrompt tables carry a `platform` field for the same reason — one prompt set per channel.

### Apollo people-search masking

On Apollo's free / basic tier, `/mixed_people/api_search` returns **masked** stubs: no `linkedin_url`, no `email`, no `last_name`. The unmasked values come from `/people/match` or `/people/bulk_match`. Code that needs LinkedIn URL must call enrichment as a fallback — `findBestContact()` does this when called with `channel: 'linkedin'`.

### Tests

There is no Jest / Vitest harness today. Smoke tests live in `scripts/test-*.ts` and run against real Apollo + Gemini keys. Run them locally before shipping anything in the search / generation path.

## Project memory

Per-conversation memory for the AI agent lives in `memory/MEMORY.md` (relative to the user's home, not this repo). That file is for transient context (current work-in-progress, recent decisions, etc.) and is not committed.

---

Last updated: April 2026, when the migration system + `scripts/` cleanup landed.
