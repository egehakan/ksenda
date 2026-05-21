# Security Policy

## Reporting a Vulnerability

If you find a security issue in Ksenda, **please do not open a
public GitHub issue.** Disclose it privately first so we have
time to ship a fix before details become public.

**Email:** `hakan@ksenda.com`
**PGP / signed:** not required.

Include:
- A description of the issue.
- A minimal proof-of-concept (curl, screenshot, short repro
  script). Avoid testing against production tenants other than
  your own.
- The commit SHA, version, or deployed URL where you observed
  it.
- Your name / handle if you'd like to be credited.

### What to expect

- **Acknowledgement** within 3 business days.
- **First triage** (severity rating, scope, plan) within 7
  business days.
- A patch released or a public advisory issued within **90
  days** of acknowledgement, whichever comes first. We will
  keep you updated if a fix legitimately needs longer.

### Scope

In scope:

- The application code in this repository.
- The hosted instance at `app.ksenda.com`, but only against
  accounts you own.

Out of scope:

- Denial-of-service of the hosted instance.
- Anything that requires social-engineering Ksenda staff,
  Hakan personally, or a tenant's user.
- Issues in third-party services (Turso, Resend, Apollo,
  Gemini, the user's own SMTP relay) unless our integration
  itself is the cause.
- Reports generated solely by automated scanners with no
  demonstrated impact.

### Safe-harbor

If you act in good faith within the scope above, we will not
pursue legal action and will treat you as a security researcher.
Please give us reasonable time to fix the issue before public
disclosure.

## Reporting non-security bugs

For non-security bugs and feature requests, open a regular
GitHub issue using the templates in `.github/ISSUE_TEMPLATE/`.
