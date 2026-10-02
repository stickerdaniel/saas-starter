# PostHog analytics

The template ships PostHog as opt-in product analytics. Nothing loads, is stored, or is sent until a visitor chooses **Allow** in the consent banner. The choice lives in a first-party `analytics_consent` cookie for 180 days and can be changed from the footer (**Privacy Settings**) or the account settings.

This guide covers what the code cannot: the PostHog dashboard, the legal constraints behind the design, and the limits you should know before relying on the numbers. The behaviour itself is specified by the tests next to [`src/lib/analytics/controller.ts`](../../../src/lib/analytics/controller.ts).

## Setup

1. Create a PostHog project (EU or US cloud) and copy its project API key.
2. Set the three public variables described in [`.env.schema`](../../../.env.schema) on the production environment:
   - `PUBLIC_POSTHOG_API_KEY`
   - `PUBLIC_POSTHOG_HOST`, for example `https://eu.i.posthog.com`
   - `PUBLIC_POSTHOG_ALLOWED_HOSTS`, the exact hostnames that may send analytics, for example `example.com,www.example.com`
3. Deploy, open the site on an allowed hostname and choose **Allow**. The first pageview appears under **Activity** in PostHog.

Test in a normal browser. The PostHog SDK treats automated browsers (Playwright, Selenium, anything with `navigator.webdriver` set) as bots and silently drops their events.

Analytics stays off on every hostname not in the list, including `localhost`. Preview builds made by `scripts/deploy.ts` also get all three values blanked, so a preview stays off even on a shared hostname. This is a hostname fence, not proof that the key belongs to the right project: listing `localhost` next to a production key sends your local testing to production. Use a separate PostHog project for local work.

Before you enable it, update the privacy policy in [`src/lib/content/legal/privacy.md`](../../../src/lib/content/legal/privacy.md) with your PostHog region, your data processing agreement and your retention settings.

## Ad blockers and the managed reverse proxy

Many blockers drop requests to `*.posthog.com`. PostHog's [managed reverse proxy](https://posthog.com/docs/advanced/proxy/managed-reverse-proxy) serves ingestion from a subdomain you own. Create it in the PostHog dashboard, add the DNS record it shows, and set `PUBLIC_POSTHOG_HOST` to that subdomain. Nothing else changes: the consent check runs in the browser before any request, whichever host receives it.

The template no longer detects blockers or switches hosts at runtime. A proxy only changes where consented events go; it is not a way around a visitor's choice.

## What leaves the browser

Only pageviews and the product events you add with `captureAnalyticsEvent` from [`src/lib/analytics/client.ts`](../../../src/lib/analytics/client.ts). Autocapture, session replay, heatmaps, web vitals, exception capture, surveys and feature flags are off.

Every event is rewritten before sending:

- URLs keep the origin, a known route path and bounded `utm_*` values. Other query parameters, fragments and credentials are removed.
- A path that is not a known page is reported as `/404`, so text typed into an address never reaches PostHog. Add new pages to [`src/lib/analytics/routes.ts`](../../../src/lib/analytics/routes.ts); a test fails until you do.
- Referrers are reduced to their origin. Search keywords, page titles and ad click ids are dropped.
- Signed-in users are identified by their user id only, never by email or name. Nothing is sent while an admin impersonates a user.

The cleaning applies to what leaves the browser, not to what the SDK keeps locally. Its storage in the visitor's browser still holds the raw first referrer and landing URL, with only the parameters in `custom_personal_data_properties` masked. That storage exists only after consent and is deleted on withdrawal, and the privacy policy says so.

This is data minimisation by syntax, not proof of anonymity. A campaign value that matches the allowed pattern can still carry text someone put into a link, and the user id links events to an account.

Turning any disabled capability back on widens what you collect. Update the banner copy and the privacy policy first, then ask existing visitors again by changing the `v1` prefix of the cookie value in [`src/lib/analytics/consent.ts`](../../../src/lib/analytics/consent.ts); any other prefix reads as undecided.

## Limits

- **Withdrawal is not a recall.** From the moment a visitor declines, no new event is accepted. An event accepted just before can still be sent: it may be encoding or waiting for the transport, in a request already in flight, or in a retry. Deleting data already in PostHog is a manual task in the PostHog dashboard (Persons → delete).
- **No pageleave or session duration.** Pageleave events are off to keep the measurement small: pageviews come from the app, and the final page of a visit has no end time. Session length in PostHog is therefore the span between events, not time on page. Turning pageleave on would still run through the consent check.
- **Events during a session change are dropped.** From the start of a sign-out or impersonation until the new session is known, custom events are discarded rather than queued, so none is attributed to the wrong account.
- **One identity per consent period.** A reload keeps the visitor's id; declining and allowing again starts a new, unlinked id. When two tabs grant at the same moment, one of them keeps a temporary id until it reloads. A tab that notices a grant made in another tab pauses until it reloads.
- **Blocked storage.** When the browser refuses local or session storage, the id lives only as long as the page, so returning visitors count as new.

## Migrating from the previous integration

Forks that used the earlier always-on PostHog setup change behaviour as follows:

- Analytics needs consent and an allowed hostname. Set `PUBLIC_POSTHOG_ALLOWED_HOSTS`, or nothing is sent.
- `PUBLIC_POSTHOG_PROXY_HOST` and the Cloudflare Worker proxy are gone. Point `PUBLIC_POSTHOG_HOST` at a managed reverse proxy instead, then delete the old Worker.
- Identify no longer sends email or name. Existing person properties in PostHog stay until you delete them.
- Client errors are no longer forwarded to PostHog. Use Sentry (`PUBLIC_SENTRY_DSN`).
- On first load after the upgrade, stored PostHog identity from the old integration is removed for visitors who have not allowed analytics.

## Turning it off

Unset `PUBLIC_POSTHOG_API_KEY` and redeploy. New page loads show no banner and load nothing; tabs already open keep running until they reload. Reverting the code instead would bring back collection without consent.
