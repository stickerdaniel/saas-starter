import { browser } from '$app/env';
import { PUBLIC_SENTRY_DSN } from '$app/env/public';
import type { Handle } from '@sveltejs/kit/hooks';
import type * as Sentry from '@sentry/sveltekit';
import { devNotice } from '#lib/dev/notice.js';

type SentryModule = typeof Sentry;

/**
 * Options shared by the browser and server SDKs. The browser adds its own
 * integrations; the server passes these to `initCloudflareSentryHandle`, whose
 * Cloudflare options accept every field here.
 */
const sentryOptions = {
	dsn: PUBLIC_SENTRY_DSN,
	tracesSampleRate: 0.1,
	traceLifecycle: 'static',
	attachStacktrace: false,
	// Keep the restrictive v10 defaults when upgrading the SDK.
	dataCollection: {
		userInfo: false,
		cookies: false,
		httpHeaders: {
			request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
			response: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] }
		},
		httpBodies: [],
		urlQueryParams: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
		genAI: { inputs: false, outputs: false },
		databaseQueryData: false,
		queues: false,
		graphQL: { document: false, variables: false },
		stackFrameVariables: false,
		frameContextLines: 0
	}
} satisfies Parameters<SentryModule['initCloudflareSentryHandle']>[0];

let initPromise: Promise<SentryModule | null> | null = null;
let client: SentryModule | null = null;
let requestHandle: Handle | null = null;

/**
 * Lazily load the Sentry SDK, initializing it in the browser.
 *
 * Mirrors the PostHog loader in `#lib/analytics/posthog.ts`: the SDK is only
 * referenced via `import type` plus a dynamic import behind the
 * `PUBLIC_SENTRY_DSN` gate, so when the DSN is unset the static build-time
 * replacement of the env var lets the whole SDK be dead-code-eliminated from
 * both the client and server bundles.
 *
 * The server SDK is initialized by `loadSentryHandle` instead, because its
 * Cloudflare Workers build has no `init`.
 *
 * Memoized per process (browser session or server instance): the browser
 * `init` runs once, and later calls resolve to the same module namespace.
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
			if (browser) {
				sentry.init({
					...sentryOptions,
					integrations: [sentry.browserSessionIntegration({ lifecycle: 'route' })]
				});
			}
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

/**
 * Lazily build the server request hook that initializes Sentry and reports the
 * request, or null when the SDK is unavailable.
 *
 * On Cloudflare Workers `@sentry/sveltekit` resolves to its `workerd` build,
 * which exports no `init`: `initCloudflareSentryHandle` initializes the SDK
 * inside each request instead. The Node build's version calls `init` once on
 * the first request, so one path covers both runtimes. Sentry requires it to
 * run before `sentryHandle()`.
 *
 * Memoized per server instance, so `init` cannot run twice on Node.
 */
export async function loadSentryHandle(): Promise<Handle | null> {
	const sentry = await loadSentry();
	if (!sentry) return null;
	if (!requestHandle) {
		// Sentry's declarations name the root `Handle` export SvelteKit 3 moved, so
		// both hooks get the hook type here instead of an inferred `any`.
		const initHandle: Handle = sentry.initCloudflareSentryHandle(sentryOptions);
		const reportHandle: Handle = sentry.sentryHandle();
		// The init hook calls `resolve(event)` without options, so nesting loses
		// nothing that `sequence` would merge.
		requestHandle = ({ event, resolve }) =>
			initHandle({
				event,
				resolve: async (initialized) => reportHandle({ event: initialized, resolve })
			});
	}
	return requestHandle;
}
