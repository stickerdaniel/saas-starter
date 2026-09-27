import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { defaultTreeAdapter as tree, parse, type DefaultTreeAdapterTypes } from 'parse5';
import { buildContentSecurityPolicy } from '../src/lib/security/csp.js';

/**
 * The report-only script-src allows the inline scripts of src/app.html by hash.
 * Those hashes only hold if the served page carries the template's script bodies
 * byte for byte.
 *
 * Cheaper layers rejected because: csp.test.ts proves the policy matches the
 * source template, but the bytes that count are the ones the deployed adapter
 * serves after SvelteKit's template substitution, the adapter build, and
 * Wrangler's minification. No script has to run, so a request-only check suffices.
 */
const appTemplate = readFileSync(new URL('../src/app.html', import.meta.url), 'utf8');
// Any valid DSN switches on the report-only script-src; nothing is sent to it.
const POLICY_DSN = 'https://e2e@example.invalid/1';

const sha256 = (content: string) =>
	'sha256-' + createHash('sha256').update(content, 'utf8').digest('base64');

// Hashes of the inline scripts a script-enabled browser would run, parsed without
// executing anything: <noscript> content stays raw text, and <template> content is
// a separate fragment the walk never enters.
function servedInlineScriptHashes(html: string): string[] {
	const hashes: string[] = [];
	const visit = (node: DefaultTreeAdapterTypes.Node) => {
		if ('tagName' in node && node.tagName === 'script') {
			if (!node.attrs.some((attribute) => attribute.name === 'src')) {
				const text = node.childNodes
					.map((child) => (tree.isTextNode(child) ? child.value : ''))
					.join('');
				hashes.push(sha256(text));
			}
		}
		if ('childNodes' in node) node.childNodes.forEach(visit);
	};
	visit(parse(html, { scriptingEnabled: true }));
	return hashes;
}

function expectAppTemplateScriptsServed(headers: Record<string, string>, html: string) {
	const policy = buildContentSecurityPolicy({ sentryDsn: POLICY_DSN, appTemplate });
	const expected = (policy.reportOnly?.['script-src'] ?? []).filter((source) =>
		source.startsWith('sha256-')
	);
	// The reload bootstrap and the mode-watcher theme initializer.
	expect(expected, 'policy hashes for the two app.html inline scripts').toHaveLength(2);

	const served = servedInlineScriptHashes(html);
	const missing = expected.filter((hash) => !served.includes(hash));
	expect(
		missing,
		`policy hashes missing from the served page: ${missing.join(', ')}; ` +
			`served inline script hashes: ${served.join(', ')}`
	).toEqual([]);

	// Deployments with a Sentry DSN also send the policy, with quoted hash tokens.
	const reportOnly = headers['content-security-policy-report-only'];
	if (reportOnly === undefined) return;
	const scriptSrc =
		reportOnly
			.split(';')
			.map((directive) => directive.trim().split(/\s+/))
			.find(([name]) => name === 'script-src')
			?.slice(1) ?? [];
	const missingFromHeader = expected.filter((hash) => !scriptSrc.includes(`'${hash}'`));
	expect(
		missingFromHeader,
		`policy hashes missing from the report-only script-src header: ${reportOnly}`
	).toEqual([]);
}

test.describe('cross-origin isolation headers', () => {
	test('SSR marketing response carries COOP + CORP and the app.html script hashes', async ({
		request
	}) => {
		const response = await request.get('/en');
		expect(response.status()).toBe(200);
		const h = response.headers();
		expect(h['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
		expect(h['cross-origin-resource-policy']).toBe('same-origin');
		expect(h['cross-origin-opener-policy']).not.toBe('same-origin');
		expect(h['content-type']).toContain('text/html');
		expectAppTemplateScriptsServed(h, await response.text());
	});

	test('signin page carries COOP + CORP and the OAuth flow is intact', async ({ page }) => {
		const response = await page.goto('/signin');
		expect(response).not.toBeNull();
		const h = response!.headers();
		expect(h['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
		expect(h['cross-origin-resource-policy']).toBe('same-origin');
		await expect(page.locator('[data-testid="email-input"]')).toBeVisible({ timeout: 30000 });
		await expect(page.locator('[data-testid="email-input"]')).toBeEnabled({ timeout: 30000 });
		const hasGoogleOAuth =
			(await page.locator('[data-testid="signin-oauth-google-button"]').count()) > 0;
		test.skip(!hasGoogleOAuth, 'Google OAuth is disabled in this environment');
		await expect(page.locator('[data-testid="signin-oauth-google-button"]')).toBeEnabled();
	});

	test('email logo is embeddable cross-origin (no same-origin CORP)', async ({ request }) => {
		// Email clients render HTML in a browser context and load the logo cross-origin;
		// same-origin CORP would block it. The _headers "!" removal must drop it on CF
		// (which joins duplicate header values with a comma rather than overriding).
		const response = await request.get('/logo-email.png');
		expect(response.status()).toBe(200);
		const h = response.headers();
		expect(h['content-type']).toBe('image/png');
		expect(h['cross-origin-resource-policy']).not.toBe('same-origin');
	});
});
