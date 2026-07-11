/**
 * Content-Security-Policy building blocks shared between the SvelteKit config
 * (svelte.config.js) and the hash regression guard (csp.test.ts).
 *
 * Enforced everywhere today: object-src 'none' and base-uri 'self' (via kit.csp
 * below) plus frame-ancestors 'none' (header-only, set in hooks.server.ts and
 * mirrored in _headers / vercel.json because it cannot ride a <meta> tag).
 *
 * script-src runs in REPORT-ONLY: it does not block anything yet, it only
 * collects violation reports so the policy can be validated before a later
 * enforcement flip. Report-only is emitted only when a Sentry DSN is configured
 * (see buildContentSecurityPolicy).
 */

// sha256 of the two inline <script> blocks that SvelteKit does not hash itself:
//  - APP_HTML: the vite:preloadError + __deployReloadArmed bootstrap in src/app.html
//  - MODE_WATCHER: the FOUC-prevention head script mode-watcher injects via {@html}
// Both are byte-identical across every rendered page. Regenerate after editing
// app.html or bumping mode-watcher: run `bun run build`, then read the sha256 of
// each inline block from a prerendered page (csp.test.ts documents the exact
// command). The mode-watcher block is the production bundler's reformatted output,
// so its hash can only be regenerated from a real build, not from source text.
export const APP_HTML_SCRIPT_HASH = 'sha256-Ml0GII2JIRPFSoeoBdrueYbrawv5r1xJB41NAsxXDxw=';
export const MODE_WATCHER_SCRIPT_HASH = 'sha256-Cr3r+iKjDTUxJaxM3r/Iq0ow6clOB9AqoT6j0wMFMIM=';

// Fingerprint of mode-watcher's setInitialMode source (node_modules/mode-watcher/
// dist/mode.js), NOT the deployed hash. A change here means the FOUC script moved
// and MODE_WATCHER_SCRIPT_HASH must be regenerated from a build. Lets the guard
// fail loudly on a mode-watcher bump without running the production bundler.
export const MODE_WATCHER_SOURCE_FINGERPRINT =
	'sha256-NNW8Woh/BBAB32UgnIohmp5dmS5tYyx630lkf4nITzY=';

/**
 * Derive a Sentry CSP report endpoint from a Sentry DSN.
 *   DSN:      https://<publicKey>@<host>/<projectId>
 *   Endpoint: https://<host>/api/<projectId>/security/?sentry_key=<publicKey>
 * Returns null for an empty or malformed DSN.
 * @param {string | undefined | null} dsn
 * @returns {string | null}
 */
export function deriveSentryReportUri(dsn) {
	if (!dsn) return null;
	try {
		const url = new URL(dsn);
		const publicKey = url.username;
		const projectId = url.pathname.replace(/^\/+/, '');
		if (!publicKey || !projectId) return null;
		return `${url.protocol}//${url.host}/api/${projectId}/security/?sentry_key=${publicKey}`;
	} catch {
		return null;
	}
}

/**
 * Shape of the object handed to `kit.csp`. Declared locally rather than reusing
 * SvelteKit's `CspDirectives` type, which is not publicly exported and breaks
 * declaration emit for this module. Structurally compatible with `kit.csp`.
 * @typedef {object} KitCspConfig
 * @property {'auto'} mode
 * @property {{ 'object-src': string[], 'base-uri': string[] }} directives
 * @property {Record<string, string[]>} [reportOnly]
 */

/**
 * Build the kit.csp config object.
 *
 * Enforced `directives` hold object-src/base-uri (unchanged strictness).
 * `reportOnly` carries the script-src policy and is only added when a Sentry DSN
 * is present: SvelteKit throws at build time if a report-only policy has no
 * report-uri/report-to, and a report-only policy with nowhere to report is a
 * no-op. Forks without Sentry therefore ship the enforced base policy only.
 *
 * @param {{ sentryDsn?: string | null }} [opts]
 * @returns {KitCspConfig}
 */
export function buildContentSecurityPolicy({ sentryDsn } = {}) {
	/** @type {KitCspConfig} */
	const csp = {
		mode: 'auto',
		directives: {
			'object-src': ['none'],
			'base-uri': ['self']
		}
	};

	const reportUri = deriveSentryReportUri(sentryDsn);
	if (reportUri) {
		csp.reportOnly = {
			// strict-dynamic trusts scripts loaded by an already-trusted script
			// (kit's nonce/hash-tagged bootstrap); the two static hashes cover the
			// inline blocks kit does not tag; wasm-unsafe-eval is for the Rive canvas.
			'script-src': [
				'self',
				'strict-dynamic',
				'wasm-unsafe-eval',
				APP_HTML_SCRIPT_HASH,
				MODE_WATCHER_SCRIPT_HASH
			],
			'object-src': ['none'],
			'base-uri': ['self'],
			'report-uri': [reportUri]
		};
	}

	return csp;
}
