# Billing

Users pick a plan on the pricing page, pay through a Stripe checkout, and from then on the limits of that plan apply. Each plan says how many of a metered action a user may take per month. When a user runs low, the app warns them; when they run out, a free user gets an upgrade button and a paying user a notice.

Billing runs on [Autumn](https://docs.useautumn.com/welcome), which sits on top of Stripe, so plans and usage gates need no webhook handlers of your own. The sample Free and Pro plans in `autumn.config.ts` show both a metered and an unlimited gate. A gate that cannot reach Autumn refuses the action instead of letting it through.

Define your own plans in `autumn.config.ts`, or generate a starter config at [app.useautumn.com/sandbox/quickstart](https://app.useautumn.com/sandbox/quickstart).

## Where to start in the code

- [`autumn.config.ts`](../../autumn.config.ts): features and plans
- [`src/lib/convex/autumn.ts`](../../src/lib/convex/autumn.ts): the backend client every gate goes through
- [Pricing page](../../src/routes/%5B%5Blang%5D%5D/%28marketing%29/pricing/)
- [Checkout components](../../src/lib/components/billing/) and the [quota banner](../../src/lib/components/message-quota-banner.svelte)
- [`.agents/skills/autumn-best-practices/SKILL.md`](../../.agents/skills/autumn-best-practices/SKILL.md): conventions for changing plans and gates
- [Environment variables](../reference/environment.md): `AUTUMN_SECRET_KEY` and `AUTUMN_WEBHOOK_SECRET`
