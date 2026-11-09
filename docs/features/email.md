# Email

The app sends the emails a product needs: verification and password reset, a note to admins about new signups and support tickets, a reply notification when an admin answers a support thread, and the [admin customer emails](../setup/admin-notifications/customer-emails.md) for first payments and cancellations. Delivery goes through [Resend](https://www.convex.dev/components/resend) with automatic retries, idempotency, and delivery tracking.

## Founder emails

Three personal emails go out as one team member, the contact person set on the welcome email card in `/admin/settings`. They are plain text with optional links, bold and lists, and replies reach the contact person's inbox:

- **Welcome**: to every new account right after signup or email verification. On while a contact person is set.
- **Feedback**: 48 hours later, only to people who never paid, as a reply in the welcome's thread when there is one.
- **Cancellation**: about an hour after a customer on a plan in `ELIGIBLE_PLANS` ([`policy.ts`](../../src/lib/convex/admin/customerNotifications/policy.ts)) schedules a cancellation, asking what was missing. It needs the [Autumn billing webhook](../setup/admin-notifications/customer-emails.md) (`AUTUMN_WEBHOOK_SECRET`) to report the cancellation within 3 hours, and asks only about cancellations made after it was switched on.

Feedback and cancellation each have their own switch and template, which only the contact person can change. To stop all three for one user without touching their other mail, run:

```bash
bunx convex run emails/founderEmails:setPersonalEmailSuppression '{"userId":"<id>","suppressed":true}' --prod
```

## Founder incident email

When a bug hit some customers, you write one plain-text email per language and send it only to the users the evidence shows were affected. Drafts are saved and localized, so a new incident needs no code change or deployment. Set the contact person on the welcome email card in `/admin/settings`, then follow the [incident-follow-up workflow](../../.agents/skills/incident-follow-up/SKILL.md) for evidence-qualified recipients, exact-message approval and delivery verification.

## HTML templates

HTML templates are Svelte components built from a shadcn-style email component library, with the same variants and design tokens as the app, and are compiled to inline HTML at build time. A snapshot test flags any unintended markup change; see [Email Development](../development.md#email-development).

## Where to start in the code

- [`src/lib/emails/`](../../src/lib/emails/): templates and the email component library
- [`src/lib/convex/emails/`](../../src/lib/convex/emails/): sending, the founder emails, and delivery events
- [Founder email settings](../../src/routes/%5B%5Blang%5D%5D/admin/settings/founder-welcome-card.svelte)
- [Resend webhook](../deployment/production.md#resend-webhook-optional): delivery, bounce, open, and click events
- [Environment variables](../reference/environment.md): `RESEND_API_KEY`, `AUTH_EMAIL`, and `EMAIL_ASSET_URL`
