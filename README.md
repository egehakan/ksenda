# Ksenda

Multi-tenant AI cold-email outreach platform. Each registered company brings their own Apollo + Gemini API keys, configures their own SMTP (Gmail / Outlook personal / custom), and runs personalized cold-email campaigns with mandatory human review before sending.

## What it does

1. Find leads via Apollo (filter by location, headcount, industry, keywords).
2. Find the best decision-maker contact at each company against a per-user target-titles list.
3. Generate ultra-personalized cold emails with Google Gemini, using the user's own company info as the SENDER context.
4. Mandatory human review and approval before any email is sent.
5. Send through the user's own SMTP (no shared sending infra).

## Multi-tenant architecture

Every registered user is an isolated tenant. They own:
- Their imported companies + emails + audit log
- Their target-titles list (seeded from a default English list on registration)
- Their active prompt
- Their fetched-organization exclusions

Each user supplies, in Settings:
- **Apollo API key** — for lead and contact search
- **Gemini API key** — for email generation
- **SMTP credentials** — Gmail (app password), Outlook personal (app password), or any custom SMTP relay

## Email verification on registration

Sign-up requires email verification. The platform sends the verification email via Resend (configured at the platform level — distinct from each tenant's own SMTP).

Required env vars on the platform:

```
RESEND_API_KEY="re_..."                            # from https://resend.com/api-keys
RESEND_FROM_EMAIL="noreply@ksenda.com"             # must be on a domain verified in Resend
RESEND_FROM_NAME="Ksenda"                           # optional
```

Before the platform can send, the `RESEND_FROM_EMAIL`'s domain (`ksenda.com`) must be verified in the Resend dashboard at https://resend.com/domains. Add the SPF + DKIM (and optionally DMARC) DNS records Resend shows you and wait for the green "Verified" status.

Flow:
1. `POST /api/auth/register` creates the user with `emailVerifiedAt = NULL`, generates a 32-byte hex `verifyToken` (24h TTL), and sends the email through Resend. No auth cookie is set.
2. The user clicks the link → `/verify-email?token=...` → page POSTs to `/api/auth/verify-email` → marks `emailVerifiedAt` and sets the auth cookie.
3. `POST /api/auth/login` returns 403 with `needsVerification: true` until the email is verified. The login page surfaces a "Resend verification email" button.
4. `POST /api/auth/resend-verification` regenerates a fresh token and re-sends. The response is generic to avoid account-existence enumeration.

Verification token storage is plaintext (single-use, 24h TTL); they're invalidated immediately on first use.

## Email provider note (May 2026)

- **Gmail**: Works with an [App Password](https://myaccount.google.com/apppasswords) (2FA must be enabled on the Google account).
- **Outlook personal** (outlook.com / hotmail.com / live.com): Works with an [App Password](https://account.live.com/proofs/AppPassword).
- **Microsoft 365 business**: Microsoft retired SMTP+Basic-Auth for Exchange Online in March–April 2026. M365 business users must currently use a custom SMTP relay (SendGrid, Postmark, Resend SMTP, Mailgun, Amazon SES SMTP, etc.) until OAuth + Microsoft Graph integration is added.
- **Any other provider**: Use the "Custom SMTP" option with host/port/auth.

## Tech stack

- Next.js 16 (App Router) + React 19
- Prisma 7 with the libSQL (Turso) adapter — SQLite-compatible
- Tailwind CSS 4 + Radix UI
- Auth: bcryptjs password hashing, JOSE-signed JWT in HttpOnly cookie
- Email: Resend for platform transactional (verify, reset); nodemailer for per-user campaign SMTP
- AI: `@google/generative-ai`
- Lead source: Apollo REST API

## Getting started

### Prerequisites
- Node.js 20+
- A Turso database (or any libSQL-compatible URL — sqld also works)

### Installation

```bash
npm install
cp .env.example .env.local
# Edit .env.local — only TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, JWT_SECRET, NEXT_PUBLIC_APP_URL are required.

# Apply all schema migrations against your Turso DB. On a fresh DB this
# creates every table from scratch (User, Company, Email, follow-ups,
# campaigns, jobs, AI-detection cache, LinkedIn channel, etc.) and seeds
# the default user + the default email / LinkedIn prompt suites.
npm run db:migrate

# Generate the Prisma client
npm run db:generate

npm run dev
```

### Database migrations

Schema changes use a small Alembic-style runner under `/migrations`. Each migration is a numbered `NNNN_*.ts` file with an `up(db)` function; applied IDs are tracked in a `_migrations` table on the DB.

```bash
npm run db:migrate           # apply all pending migrations
npm run db:migrate:list      # show ✓/○ status of every migration
npm run db:migrate:baseline  # one-time: adopt this system on an existing DB
                             # by marking every current file applied without
                             # running it
```

See [`migrations/README.md`](migrations/README.md) for the rules on adding new ones. **Do not** put schema changes in `scripts/` — that directory is for long-lived ops utilities only (the `scripts/` directory is gitignored and not shipped publicly).

Open http://localhost:3000. The first time you visit, you can either log in with the default user or click **Create one** to register a new tenant.

### Environment variables

```env
TURSO_DATABASE_URL="libsql://your-db.turso.io"
TURSO_AUTH_TOKEN="..."
JWT_SECRET="long-random-string"
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Optional, only used by the migration script for the default seeded user
# DEFAULT_USER_EMAIL="admin@example.com"
# DEFAULT_USER_PASSWORD="change-me"
```

API keys (Apollo, Gemini, SMTP) are **per-user** and configured in the app's Settings tab — they are deliberately *not* environment variables.

## Pipeline states

Each company exists in exactly one state:
- `pending_generation` — Imported, awaiting contact + email generation
- `email_not_generated` — Generation failed (no contact, no email, generation error). Retry or reset available.
- `pending_review` — Email generated, awaiting human review
- `approved_to_send` — Reviewed and approved, ready to send
- `sent` — Email delivered

## API surface (all tenant-scoped)

| Endpoint | Method | Description |
|---|---|---|
| `/api/auth/register` | POST | Create a new user (tenant) |
| `/api/auth/login` | POST | Sign in (sets HttpOnly auth cookie) |
| `/api/auth/logout` | POST | Clear session |
| `/api/auth/me` | GET | Current user's profile + flags (which keys are configured) |
| `/api/users/me` | PATCH | Update profile, API keys, SMTP, sender, signature |
| `/api/users/me/verify-smtp` | POST | Validate the saved SMTP credentials without sending mail |
| `/api/companies/search` | POST | Search Apollo (uses *your* Apollo key) |
| `/api/companies/import` | POST | Import + auto-find-contact + auto-generate emails (uses *your* Apollo + Gemini keys) |
| `/api/companies/[id]` | GET, PATCH, DELETE | |
| `/api/companies/[id]/find-contact` | POST | |
| `/api/companies/[id]/generate` | POST | |
| `/api/emails/[id]/review` | POST | |
| `/api/emails/[id]/approve` | POST | |
| `/api/emails/[id]/send` | POST | Sends via *your* SMTP |
| `/api/pipeline/stats` | GET | |
| `/api/pipeline/companies` | GET | |
| `/api/pipeline/process-all` | POST | |
| `/api/pipeline/send-all` | POST | |
| `/api/pipeline/batch-{approve,delete,retry,send}` | POST | |
| `/api/prompts/active` | GET, PUT | The current user's active prompt |
| `/api/target-titles` | GET, POST, DELETE | |
| `/api/db/clear` | POST | Wipe **the current user's** companies, emails, audit logs (titles + prompts preserved) |

## License

Ksenda is **source-available** under the [PolyForm Noncommercial 1.0.0](LICENSE) license. In plain English:

- ✅ Read it, study it, fork it for personal, research, academic, or non-profit use.
- ✅ Self-host it for yourself.
- ✅ Contribute back via pull requests (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- ❌ Use it (modified or unmodified) to run outbound marketing for any business — including your own — without a separate commercial license.
- ❌ Offer it as a hosted service to third parties.

For commercial use, email `hakan@ksenda.com`.

See [LICENSE](LICENSE) for the full legal text and
[SECURITY.md](SECURITY.md) for security disclosures.
