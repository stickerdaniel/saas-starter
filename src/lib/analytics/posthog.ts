import {
	PUBLIC_POSTHOG_API_KEY,
	PUBLIC_POSTHOG_HOST,
	PUBLIC_POSTHOG_PROXY_HOST
} from '$env/static/public';

const READY_EVENT = 'posthog:ready';
const ADBLOCK_DETECT_TIMEOUT_MS = 3000;

let initPromise: Promise<PostHogClient | null> | null = null;
let client: PostHogClient | null = null;

type PostHogClient = typeof import('posthog-js').default;

function isBrowser(): boolean {
	return typeof window !== 'undefined';
}

async function detectAdBlock(host: string): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), ADBLOCK_DETECT_TIMEOUT_MS);

		await fetch(`${host}/static/array.js`, {
			method: 'GET',
			mode: 'no-cors',
			cache: 'no-store',
			signal: controller.signal
		});

		clearTimeout(timeoutId);
		return false;
	} catch {
		return true;
	}
}

export async function initPosthog(): Promise<PostHogClient | null> {
	if (!isBrowser()) return null;
	if (client) return client;
	if (initPromise) return initPromise;

	initPromise = (async () => {
		if (!PUBLIC_POSTHOG_API_KEY || !PUBLIC_POSTHOG_HOST) return null;

		try {
			const posthog = (await import('posthog-js')).default;
			const isBlocked = await detectAdBlock(PUBLIC_POSTHOG_HOST);
			const apiHost = isBlocked
				? PUBLIC_POSTHOG_PROXY_HOST || PUBLIC_POSTHOG_HOST
				: PUBLIC_POSTHOG_HOST;

			posthog.init(PUBLIC_POSTHOG_API_KEY, {
				api_host: apiHost,
				ui_host: 'https://eu.posthog.com',
				person_profiles: 'identified_only'
			});

			client = posthog;
			window.dispatchEvent(new CustomEvent(READY_EVENT));
			return posthog;
		} catch (error: unknown) {
			if (import.meta.env.DEV) {
				console.warn('PostHog initialization failed:', error);
			}
			initPromise = null;
			return null;
		}
	})();

	return initPromise;
}

export function getPosthog(): PostHogClient | null {
	return client;
}

export function onPosthogReady(callback: () => void): () => void {
	if (!isBrowser()) return () => {};

	function handler(): void {
		callback();
	}
	window.addEventListener(READY_EVENT, handler);
	return () => window.removeEventListener(READY_EVENT, handler);
}
