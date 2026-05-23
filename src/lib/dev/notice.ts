/**
 * Dev-only console notice for gracefully-degraded features.
 *
 * Use this at the call site of an optional feature that silently degrades
 * when its env keys are unset (OAuth providers, PostHog, Sentry, Tolgee
 * live editing). The notice names the feature and the keys to set so the
 * developer learns about the gate at the moment they hit it.
 *
 * **Dedupe scope is per-process.** Calling this from a Convex isolate logs
 * once per cold start; calling it from a SvelteKit server logs once per
 * server boot; calling it from the browser logs once per page session.
 * No persistence — that's intentional, otherwise the notice never fires
 * again after a one-time observation.
 *
 * **Active only in dev** (`NODE_ENV === 'development'` under SvelteKit and
 * in the browser, `LOCAL_CONVEX_DEV` on the Convex backend). The helper is
 * a no-op in production builds and on cloud deployments.
 */

import { fixHintFor, type DevFeatureScope } from './features';

const seen = new Set<string>();

function isDev(scope: DevFeatureScope): boolean {
	if (scope === 'convex') {
		return typeof process !== 'undefined' && process.env?.LOCAL_CONVEX_DEV === 'true';
	}
	// SvelteKit SSR reads NODE_ENV from Node; the browser gets it via Vite's
	// static define replacement at build time. Avoids the dynamic
	// `import.meta.env` access that Vite's module-runner rejects, and
	// type-checks under both the Vite tsconfig and the Convex tsconfig
	// (which has @types/node but not Vite's import.meta augmentations).
	return typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
}

export type DevNoticeOptions = {
	/** Human-readable feature name (e.g. "GitHub sign-in"). */
	feature: string;
	/** Env var names that gate the feature. */
	missing: readonly string[];
	/** Runtime scope — drives the fix command we suggest. */
	scope: DevFeatureScope;
	/** Reference doc or example file to point developers at. */
	docs?: string;
};

export function devNotice(opts: DevNoticeOptions): void {
	if (!isDev(opts.scope)) return;
	if (opts.missing.length === 0) return;

	const dedupeKey = `${opts.feature}::${opts.missing.join(',')}`;
	if (seen.has(dedupeKey)) return;
	seen.add(dedupeKey);

	const fixes = opts.missing.map((key) => fixHintFor(opts.scope, key)).join('\n  ');
	const docs = opts.docs ?? (opts.scope === 'convex' ? '.env.convex.example' : '.env.schema');

	console.warn(
		`[dev] ${opts.feature} disabled. Missing: ${opts.missing.join(', ')}.\n` +
			`  Fix: ${fixes}\n` +
			`  See: ${docs}`
	);
}

/**
 * Visible-for-testing — drops the dedupe set so unit tests can re-trigger
 * the same notice. Production code should never call this.
 */
export function _resetDevNoticeDedupeForTests(): void {
	seen.clear();
}
