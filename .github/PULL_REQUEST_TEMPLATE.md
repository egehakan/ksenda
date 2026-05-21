<!-- Thanks for the PR. Please fill out the sections below. -->

## What does this change?

<!-- One or two sentences. -->

## Why?

<!-- The reason — link an issue with "Fixes #N" or "Refs #N" if there is one. -->

## How was it tested?

- [ ] `npm run lint` passes
- [ ] Manually verified locally
- [ ] (If touching schema) wrote a migration under `/migrations/NNNN_*.ts` and ran `npm run db:migrate`
- [ ] (If touching the pipeline) reviewed [`CLAUDE.md`](../CLAUDE.md) for the per-tenant invariants

## Checklist

- [ ] I agree to license this contribution under [PolyForm Noncommercial 1.0.0](../LICENSE).
- [ ] No secrets, real API keys, or `.env.local` contents in the diff.
- [ ] Commits are scoped to one logical change.
