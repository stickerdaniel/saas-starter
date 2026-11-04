// @vitest-environment node

/**
 * About and Contact as the server renders them. Agents and trust checks read this HTML
 * without running scripts and look for at least 500 characters of text on each page,
 * with whatever identity the fork configured.
 */

import { createRequire } from 'node:module';
import type { ConvexClient } from 'convex/browser';
import { describe, expect, it, vi } from 'vitest';
import type * as LegalConfig from '#lib/config/legal.js';

const page = vi.hoisted(() => ({
	url: new URL('https://example.com/en/about'),
	params: { lang: 'en' }
}));

vi.mock('$app/state', () => ({ page }));
vi.mock('$app/env/public', () => ({ PUBLIC_SITE_URL: 'https://example.com' }));

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
	JSDOM: new (html?: string) => { window: { document: Document } };
};

interface LegalIdentity {
	brandName: string;
	companyName: string;
	operatorName: string;
	address: LegalConfig.LegalPostalAddress;
	email: { user: string; domain: string; tld: string };
}

const { LEGAL_CONFIG: TEMPLATE } =
	await vi.importActual<typeof LegalConfig>('#lib/config/legal.js');

/** The identity the setup integration fixture writes. */
const FORK: LegalIdentity = {
	brandName: 'Northwind Labs',
	companyName: 'Northwind Labs GmbH',
	operatorName: 'Anne Weber',
	address: {
		streetAddress: 'Hauptstrasse 5',
		postalCode: '12345',
		addressLocality: 'Berlin',
		addressCountry: 'DE'
	},
	email: { user: 'kontakt', domain: 'northwind-labs', tld: 'de' }
};

const IDENTITIES: Array<{ label: string; legal: LegalIdentity }> = [
	{ label: 'template', legal: TEMPLATE },
	{ label: 'fork', legal: FORK },
	{ label: 'sole proprietor', legal: { ...FORK, companyName: '' } }
];

/**
 * Renders a page with `legal` as `LEGAL_CONFIG`. The content modules read the config once
 * at import, so each render loads a fresh module graph.
 */
async function serverRender(route: 'about' | 'contact', legal: LegalIdentity): Promise<Element> {
	vi.resetModules();
	vi.doMock('#lib/config/legal.js', async (importOriginal) => ({
		...(await importOriginal<typeof LegalConfig>()),
		LEGAL_CONFIG: legal
	}));
	page.url = new URL(`https://example.com/en/${route}`);
	const { render } = await import('svelte/server');
	const { default: Provider } = await import('#lib/chat/ui/test-fixtures/ChatTestProvider.svelte');
	const { default: Page } =
		route === 'about'
			? await import('./about/+page.svelte')
			: await import('./contact/+page.svelte');
	const { body } = render(Provider, {
		props: {
			// Nothing subscribes during a server render.
			client: {} as ConvexClient,
			content: Page,
			contentProps: {}
		}
	});
	const content = new JSDOM(body).window.document.querySelector('[lang="en"]');
	if (!content) throw new Error(`The ${route} page rendered no English content.`);
	return content;
}

/** Visible text: the email decoys are hidden from people and assistive technology alike. */
function visibleText(content: Element): string {
	const copy = content.cloneNode(true) as Element;
	for (const decoy of copy.querySelectorAll('[aria-hidden="true"]')) decoy.remove();
	return copy.textContent!.replace(/\s+/g, ' ').trim();
}

function linkTarget(content: Element, name: string): string | null | undefined {
	return [...content.querySelectorAll('a')]
		.find((link) => link.textContent?.trim() === name)
		?.getAttribute('href');
}

describe.each(IDENTITIES)('server-rendered company pages with the $label identity', ({ legal }) => {
	const organization = legal.companyName || legal.operatorName;

	it('describes the product and its publisher on the About page', async () => {
		const text = visibleText(await serverRender('about', legal));

		expect(text.length).toBeGreaterThanOrEqual(500);
		expect(text).toContain(`About ${legal.brandName}`);
		expect(text).toContain(`${organization} publishes ${legal.brandName}`);
		expect(text).toContain(`${legal.operatorName} runs it day to day`);
	});

	it('lists the provider, the email and the support chat on the Contact page', async () => {
		const content = await serverRender('contact', legal);
		const text = visibleText(content);
		const { streetAddress, postalCode, addressLocality, addressCountry } = legal.address;

		expect(text.length).toBeGreaterThanOrEqual(500);
		expect(text).toContain(`${organization} operates ${legal.brandName}`);
		expect(text).toContain(`Operated by ${legal.operatorName}`);
		expect(text).toContain(`${streetAddress}, ${postalCode} ${addressLocality}, ${addressCountry}`);
		expect(text).toContain(`Email: ${legal.email.user}@${legal.email.domain}.${legal.email.tld}`);
		expect(linkTarget(content, 'Open the support chat')).toBe('/en/?support=open');
		expect(linkTarget(content, 'Impressum')).toBe('/en/impressum');
	});
});
