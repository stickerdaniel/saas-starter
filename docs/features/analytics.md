# Analytics

[PostHog](https://posthog.com/) loads only after a visitor allows it in the consent banner, and only on the hostnames you list. Pageviews are cleaned of query secrets, search terms and unknown paths before they leave the browser, and signed-in users are identified by id only. Visitors can change their choice later from the footer or their account settings.

Analytics is off until you set the PostHog variables. Preview builds made by `scripts/deploy.ts` get those values blanked, so a preview stays off.

## Where to start in the code

- [PostHog analytics guide](../setup/analytics/posthog.md): setup, the managed reverse proxy, and the limits of the numbers
- [`src/lib/analytics/`](../../src/lib/analytics/): consent, the hostname fence, and pageview sanitizing
- [Environment variables](../reference/environment.md): `PUBLIC_POSTHOG_API_KEY`, `PUBLIC_POSTHOG_HOST`, and `PUBLIC_POSTHOG_ALLOWED_HOSTS`
