import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_HTML_SCRIPT_HASH, MODE_WATCHER_SCRIPT_HASH } from '../src/lib/security/csp.js';

/** The inline scripts SvelteKit does not hash itself, keyed by their csp.js constant. */
export const OWNED_SCRIPT_HASHES: Readonly<Record<string, string>> = {
	APP_HTML_SCRIPT_HASH,
	MODE_WATCHER_SCRIPT_HASH
};

// Both owned scripts come from app.html and the root layout, so any page carries
// them. This one renders without backend reads.
export const VERIFIED_PAGE_PATH = '/en/privacy';

const RENDER_TIMEOUT_MS = 60_000;
const SCRIPT_ELEMENT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const EXTERNAL_SOURCE = /(?:^|\s)src\s*=/i;

export type RenderedPage = { status: number; contentType: string | null; html: string };

function sha256Source(content: string): string {
	return `sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}`;
}

/** CSP source expressions of every inline script body, hashed byte for byte. */
export function inlineScriptHashes(html: string): Set<string> {
	const hashes = new Set<string>();
	for (const [, attributes, body] of html.matchAll(SCRIPT_ELEMENT)) {
		if (!EXTERNAL_SOURCE.test(attributes!)) hashes.add(sha256Source(body!));
	}
	return hashes;
}

/**
 * Names each owned constant whose hash matches no inline script in the page.
 * Framework bootstrap and data scripts may appear in any number; only a missing
 * owned hash, or a page that is not a rendered HTML document, is a problem.
 */
export function ownedScriptHashProblems(
	page: RenderedPage,
	owned: Readonly<Record<string, string>> = OWNED_SCRIPT_HASHES
): string[] {
	if (page.status !== 200 || !page.contentType?.startsWith('text/html')) {
		return [
			`expected a 200 text/html page, got ${page.status} ${page.contentType ?? 'without a content type'}`
		];
	}
	const emitted = inlineScriptHashes(page.html);
	return Object.entries(owned)
		.filter(([, hash]) => !emitted.has(hash))
		.map(([name, hash]) => `${name} (${hash}) matches no inline <script> body`);
}

// Rendering runs under Node, not Bun: mode-watcher builds its script from
// Function.prototype.toString(), whose text differs between the two runtimes.
function renderEmittedPage(
	serverDirectory: string,
	pageUrl: string,
	env: NodeJS.ProcessEnv
): RenderedPage {
	const resultDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-hashes-'));
	const resultFile = path.join(resultDirectory, 'page.json');
	try {
		const child = spawnSync(
			'node',
			[
				fileURLToPath(new URL('./csp-hashes-render.mjs', import.meta.url)),
				serverDirectory,
				pageUrl,
				resultFile
			],
			{
				env,
				stdio: ['ignore', 'inherit', 'inherit'],
				timeout: RENDER_TIMEOUT_MS,
				killSignal: 'SIGKILL'
			}
		);
		if (child.error) {
			throw new Error(`could not render ${pageUrl} under Node: ${child.error.message}`);
		}
		if (child.status !== 0 || !fs.existsSync(resultFile)) {
			throw new Error(
				`rendering ${pageUrl} under Node exited with ${child.status ?? child.signal}`
			);
		}
		return JSON.parse(fs.readFileSync(resultFile, 'utf8')) as RenderedPage;
	} finally {
		fs.rmSync(resultDirectory, { recursive: true, force: true });
	}
}

/**
 * Checks the owned CSP hashes against a page rendered by the server this build
 * just emitted. Returns false, after explaining why, when the build must fail.
 */
export function verifyEmittedScriptHashes(options: {
	env: NodeJS.ProcessEnv;
	siteOrigin: string;
	serverDirectory?: string;
}): boolean {
	const { env, siteOrigin, serverDirectory = path.resolve('.svelte-kit/output/server') } = options;
	if (env.WORKERS_CI || env.CF_PAGES) {
		// Cloudflare serves a Worker that wrangler bundles again at upload, so the
		// bytes it sends are not the ones a Node render of this output produces.
		console.warn(
			'[csp-hashes] Not verified: Cloudflare Worker output is rebundled at upload, so a Node render of this build does not show the inline script bytes it serves.'
		);
		return true;
	}

	const pageUrl = new URL(VERIFIED_PAGE_PATH, siteOrigin).href;
	let page: RenderedPage;
	try {
		page = renderEmittedPage(serverDirectory, pageUrl, env);
	} catch (error) {
		console.error(`[csp-hashes] ${error instanceof Error ? error.message : String(error)}`);
		return false;
	}

	const problems = ownedScriptHashProblems(page);
	if (problems.length === 0) {
		console.log(`[csp-hashes] ${Object.keys(OWNED_SCRIPT_HASHES).join(' and ')} match ${pageUrl}.`);
		return true;
	}
	console.error(
		[
			`[csp-hashes] The SSR HTML this build emits for ${pageUrl} does not match src/lib/security/csp.js:`,
			...problems.map((problem) => `  ${problem}`),
			`Inline script hashes the page emits: ${[...inlineScriptHashes(page.html)].join(', ') || 'none'}`,
			'Update the named constant from the matching emitted script; hashes computed under Bun differ.'
		].join('\n')
	);
	return false;
}
