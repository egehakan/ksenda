# Contributing to Ksenda

Thanks for taking a look. Ksenda is **source-available, not
open source** — see [LICENSE](LICENSE) for the exact terms. In
short: you can read it, learn from it, self-host it for
personal/research/non-profit use, and contribute back, but you
cannot use it to run marketing for a business without a
separate commercial license.

If those terms work for you, contributions are welcome.

## Before you open a PR

1. **Open an issue first** for anything bigger than a typo or
   a one-line bug fix. It saves both of us from arguing in a PR
   diff about whether the change should exist.
2. **Check the project conventions in [`CLAUDE.md`](CLAUDE.md).**
   It documents the things that are not obvious from reading
   the code: how migrations work, where state lives, the
   per-tenant model, the LinkedIn channel quirks. Following
   it is the difference between a 5-minute review and a
   30-minute one.

## Inbound = outbound

By submitting a pull request you agree that your contribution
is licensed under the same [PolyForm Noncommercial 1.0.0
license](LICENSE) as the rest of the project, and you confirm
you have the right to license it that way.

There is no separate CLA to sign.

## Local setup

```bash
git clone https://github.com/egehakan/ksenda.git
cd ksenda
npm install
cp .env.example .env.local
# Fill in TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, JWT_SECRET, NEXT_PUBLIC_APP_URL
npm run db:migrate
npm run db:generate
npm run dev
```

You will need:
- Node 20+
- A Turso (or any libSQL-compatible) database — free tier works.
- An Apollo API key + Gemini API key + SMTP credentials, but
  these are entered inside the app per-user, not via env.

## What I'll accept

- Bug fixes with a clear reproduction.
- Performance improvements with before/after numbers.
- Test coverage for code that ships without it.
- Documentation improvements.
- Provider integrations (new SMTP relay quirks, new lead
  source) **only after an issue discusses scope.**

## What I will not accept

- Telemetry or analytics added to the self-hosted path.
- Changes that weaken the per-tenant isolation guarantees in
  [`CLAUDE.md`](CLAUDE.md).
- Cosmetic refactors with no behavior change.
- Vendored dependencies / lockfile-only changes without a
  reason.
- Anything that requires running a paid service to validate.

## Coding style

- TypeScript strict.
- Run `npm run lint` before pushing.
- Match the surrounding code; this is not a refactor PR
  invitation.
- Keep changes scoped — one logical change per PR.

## Commit messages

- Imperative present tense: "fix retry path", not "fixed retry
  path".
- Reference the issue with `Fixes #N` or `Refs #N` in the body
  when relevant.

## Questions

Open a [GitHub Discussion](https://github.com/egehakan/ksenda/discussions)
or email `hakan@ksenda.com`.
