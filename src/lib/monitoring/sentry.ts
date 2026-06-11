import { PUBLIC_SENTRY_DSN } from '$env/static/public';
import type * as Sentry from '@sentry/sveltekit';
import { devNotice } from '$lib/dev/notice';

type SentryModule = typeof Sentry;

let initPromise: Promise<SentryModule | null> | null = null;
let client: SentryModule | null = null;

/**
 * Lazily load and initialize the Sentry SDK.
 *
 * Mirrors the PostHog loader in `$lib/analytics/posthog.ts`: the SDK is only
 * referenced via `import type` plus a dynamic import behind the
 * `PUBLIC_SENTRY_DSN` gate, so when the DSN is unset the static build-time
 * replacement of the env var lets the whole SDK be dead-code-eliminated from
 * both the client and server bundles.
 *
 * Memoized per process (browser session or server instance): `init` runs
 * once, and later calls resolve to the same module namespace.
 */
export async function loadSentry(): Promise<SentryModule | null> {
	if (!PUBLIC_SENTRY_DSN) {
		devNotice({
			feature: 'Error monitoring (Sentry)',
			missing: ['PUBLIC_SENTRY_DSN'],
			scope: 'vite-public'
		});
		return null;
	}

	if (client) return client;
	if (initPromise) return initPromise;

	initPromise = (async () => {
		try {
			const sentry = await import('@sentry/sveltekit');
			sentry.init({
				dsn: PUBLIC_SENTRY_DSN,
				tracesSampleRate: 0.1
			});
			client = sentry;
			return sentry;
		} catch (error: unknown) {
			if (import.meta.env.DEV) {
				console.warn('Sentry initialization failed:', error);
			}
			initPromise = null;
			return null;
		}
	})();

	return initPromise;
}
