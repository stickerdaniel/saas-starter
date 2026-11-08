import { browser, version } from '$app/env';
import { PUBLIC_SENTRY_DSN } from '$app/env/public';
import type { Handle } from '@sveltejs/kit/hooks';
import type * as Sentry from '@sentry/sveltekit';
import { devNotice } from '#lib/dev/notice.js';

type SentryModule = typeof Sentry;
type SentryIntegration = Parameters<SentryModule['addIntegration']>[0];

/**
 * Options shared by the browser and server SDKs, and the integration both add.
 * The server passes the options to `initCloudflareSentryHandle`, whose
 * Cloudflare options accept every field here.
 *
 * The projection loads with the SDK, behind the same `PUBLIC_SENTRY_DSN` gate,
 * so a build without a DSN ships neither in its first paint.
 */
async function loadSentryOptions() {
	const [{ scrubBreadcrumb, scrubEvent }, { projectEnvelopeTrace }] = await Promise.all([
		import('#lib/monitoring/sentry-scrub.js'),
		import('#lib/diagnostics/sentry-projection.js')
	]);

	/**
	 * Projects each envelope header's trace context, which the SDK builds after
	 * the event hooks, from an inbound request's baggage when there is one. An
	 * integration's `setup` runs once for every client the SDK creates: the
	 * browser client, the Node server client, and the Cloudflare client, which
	 * the SDK keeps across requests.
	 */
	const envelopeTraceIntegration: SentryIntegration = {
		name: 'EnvelopeTraceProjection',
		setup(sentryClient) {
			sentryClient.on('beforeEnvelope', ([header]) =>
				projectEnvelopeTrace(header, sentryClient.getDsn()?.publicKey)
			);
		}
	};

	const options = {
		dsn: PUBLIC_SENTRY_DSN,
		// The compiled build, the same name the Vite plugin gives uploaded source
		// maps. Without it the SDK reads the release from runtime environment
		// variables, which can name a different build.
		release: version,
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
		},
		// The policy above filters by name. These reduce every event, transaction
		// and breadcrumb to the fields sentry-scrub.ts allows, on both runtimes.
		beforeSend: scrubEvent,
		beforeSendTransaction: scrubEvent,
		beforeBreadcrumb: scrubBreadcrumb
	} satisfies Parameters<SentryModule['initCloudflareSentryHandle']>[0];

	return { options, envelopeTraceIntegration };
}

let initPromise: Promise<SentryModule | null> | null = null;
let client: SentryModule | null = null;
let sentrySetup: Awaited<ReturnType<typeof loadSentryOptions>> | null = null;
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
			const [sentry, shared] = await Promise.all([
				import('@sentry/sveltekit'),
				loadSentryOptions()
			]);
			if (browser) {
				sentry.init({
					...shared.options,
					integrations: [
						sentry.browserSessionIntegration({ lifecycle: 'route' }),
						shared.envelopeTraceIntegration
					]
				});
			}
			sentrySetup = shared;
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
 * The Sentry module if `loadSentry` already loaded it, else null. Never starts a
 * load. On the server the request hook loads and initializes it before any load
 * function runs, so code inside a request reads the request's client.
 */
export function loadedSentry(): SentryModule | null {
	return client;
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
	if (!sentry || !sentrySetup) return null;
	if (!requestHandle) {
		// Sentry's declarations name the root `Handle` export SvelteKit 3 moved, so
		// both hooks get the hook type here instead of an inferred `any`.
		const initHandle: Handle = sentry.initCloudflareSentryHandle({
			...sentrySetup.options,
			integrations: [sentrySetup.envelopeTraceIntegration]
		});
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
