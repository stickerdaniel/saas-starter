import { createHash } from 'node:crypto';
import { defaultTreeAdapter as tree, parse } from 'parse5';

/**
 * Content-Security-Policy building blocks shared between the SvelteKit config
 * (svelte.config.js) and the hash regression guards (csp.test.ts and
 * e2e/public-security-headers.spec.ts).
 *
 * Enforced everywhere today: object-src 'none' and base-uri 'self' (via kit.csp
 * below) plus frame-ancestors 'none' (header-only, set in hooks.server.ts and
 * mirrored in _headers / vercel.json because it cannot ride a <meta> tag).
 *
 * script-src runs in REPORT-ONLY: it does not block anything yet, it only
 * collects violation reports so the policy can be validated before a later
 * enforcement flip. Report-only is emitted only when a Sentry DSN is configured
 * (see buildContentSecurityPolicy).
 *
 * SvelteKit tags its own inline scripts but not the ones written in src/app.html.
 * Those are served verbatim on every page, so their hashes are derived from the
 * template itself and follow any edit to it. The mode-watcher initializer lives in
 * app.html for this reason: the copy ModeWatcher injects is serialized from bundled
 * function source, which each bundler reformats into different bytes.
 */

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

// Elements whose content a script-enabled browser parses as text or never runs.
// <noscript> belongs here because its content is raw text while scripting is on.
const INERT_CONTAINERS = new Set([
	'iframe',
	'noembed',
	'noframes',
	'noscript',
	'plaintext',
	'style',
	'template',
	'textarea',
	'title',
	'xmp'
]);

/** @typedef {import('parse5').DefaultTreeAdapterTypes.Node} HtmlNode */
/** @typedef {import('parse5').DefaultTreeAdapterTypes.Element} HtmlElement */

/**
 * @param {string} reason
 * @returns {never}
 */
function unsupportedTemplate(reason) {
	throw new Error(
		`src/app.html contains ${reason}, which the CSP hash extractor in ` +
			'src/lib/security/csp.js does not support. Keep inline scripts as attribute-less ' +
			'<script> blocks in normal document context with fixed LF-only bodies.'
	);
}

/**
 * Offsets of every case-insensitive `<script` in `text`.
 * @param {string} text
 */
function scriptTagOffsets(text) {
	/** @type {number[]} */
	const offsets = [];
	for (let index = text.indexOf('<'); index !== -1; index = text.indexOf('<', index + 1)) {
		if (text.slice(index, index + 7).toLowerCase() === '<script') offsets.push(index);
	}
	return offsets;
}

/**
 * CSP `sha256-` sources for the inline scripts of an app template.
 *
 * Parses the template as a script-enabled browser does (parse5 with
 * `scriptingEnabled`), so only scripts that would actually run count, and hashes
 * each body's exact source span as UTF-8, untrimmed. Every `<script` in the source
 * must be one of those scripts; anything the policy could miss or mis-hash throws
 * instead: a script with attributes or outside the HTML namespace, a `<script`
 * inside a comment, an attribute value, <template>, <noscript> or a raw-text
 * element, an unterminated script, a CR or U+0000 in a body, a SvelteKit or
 * `%lang%` placeholder in a body (substituted after hashing), and a body whose
 * source span differs from the parsed script text.
 *
 * @param {string} appTemplate content of src/app.html
 * @returns {string[]} deduplicated `sha256-<base64>` sources in template order
 */
export function appTemplateScriptHashes(appTemplate) {
	if (typeof appTemplate !== 'string' || appTemplate === '') {
		throw new TypeError('appTemplateScriptHashes needs the content of src/app.html');
	}

	const document = parse(appTemplate, { scriptingEnabled: true, sourceCodeLocationInfo: true });
	/** @type {string[]} */
	const hashes = [];
	/** @type {Set<number>} */
	const hashedTagOffsets = new Set();

	/** @param {string} text @param {string} context */
	function rejectScriptText(text, context) {
		if (scriptTagOffsets(text).length > 0) unsupportedTemplate(`a <script inside ${context}`);
	}

	/** @param {HtmlElement} script */
	function hashScript(script) {
		if (script.namespaceURI !== HTML_NAMESPACE) {
			unsupportedTemplate('a <script> outside the HTML namespace');
		}
		if (script.attrs.length > 0) unsupportedTemplate('a <script> tag with attributes');
		const location = script.sourceCodeLocation;
		if (!location?.startTag || !location.endTag) {
			unsupportedTemplate('an unterminated <script> block');
		}

		const body = appTemplate.slice(location.startTag.endOffset, location.endTag.startOffset);
		if (body.includes('\r')) unsupportedTemplate('a CR character inside a <script> body');
		if (body.includes('\0')) unsupportedTemplate('a U+0000 character inside a <script> body');
		if (body.includes('%sveltekit.') || body.includes('%lang%')) {
			unsupportedTemplate('a runtime placeholder inside a <script> body');
		}
		const parsedText = script.childNodes
			.map((child) => (tree.isTextNode(child) ? child.value : ''))
			.join('');
		if (body !== parsedText) {
			unsupportedTemplate('a <script> body whose source differs from its parsed text');
		}

		hashes.push('sha256-' + createHash('sha256').update(body, 'utf8').digest('base64'));
		hashedTagOffsets.add(location.startTag.startOffset);
	}

	/** @param {HtmlNode} node @param {string | null} inertContainer */
	function visit(node, inertContainer) {
		if (tree.isCommentNode(node)) {
			rejectScriptText(node.data, 'an HTML comment');
			return;
		}
		if (tree.isTextNode(node)) {
			if (inertContainer) rejectScriptText(node.value, `<${inertContainer}>`);
			return;
		}
		if (!tree.isElementNode(node)) {
			if ('childNodes' in node) for (const child of node.childNodes) visit(child, inertContainer);
			return;
		}

		for (const attribute of node.attrs) rejectScriptText(attribute.value, 'an attribute value');
		if (node.tagName === 'script') {
			if (inertContainer) unsupportedTemplate(`a <script> inside <${inertContainer}>`);
			hashScript(node);
			return;
		}

		const container = inertContainer ?? (INERT_CONTAINERS.has(node.tagName) ? node.tagName : null);
		const children =
			node.tagName === 'template' && 'content' in node
				? [...node.childNodes, ...tree.getTemplateContent(node).childNodes]
				: node.childNodes;
		for (const child of children) visit(child, container);
	}

	visit(document, null);

	// Backstop: a `<script` that parsed as none of the scripts above sits in a
	// context this walk did not name, so its bytes are not covered.
	if (scriptTagOffsets(appTemplate).some((offset) => !hashedTagOffsets.has(offset))) {
		unsupportedTemplate('a <script that does not parse as an inline script');
	}

	return [...new Set(hashes)];
}

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
 * The app template is required even without a DSN, so a template the hash
 * extractor rejects fails every build rather than only Sentry-enabled ones.
 *
 * @param {{ sentryDsn?: string | null, appTemplate: string }} opts
 *   `appTemplate` is the content of src/app.html, whose inline scripts script-src allows.
 * @returns {KitCspConfig}
 */
export function buildContentSecurityPolicy({ sentryDsn, appTemplate }) {
	const templateScriptHashes = appTemplateScriptHashes(appTemplate);

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
			// (kit's nonce/hash-tagged bootstrap); the template hashes cover the
			// inline blocks kit does not tag; wasm-unsafe-eval is for the Rive canvas.
			'script-src': ['self', 'strict-dynamic', 'wasm-unsafe-eval', ...templateScriptHashes],
			'object-src': ['none'],
			'base-uri': ['self'],
			'report-uri': [reportUri]
		};
	}

	return csp;
}
