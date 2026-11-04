// @vitest-environment node

import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { GET } from './+server';

/** The status and Location SvelteKit sends for a GET with these route params. */
async function redirectFor(lang: string | undefined) {
	const event = { params: { lang } } as Parameters<typeof GET>[0];
	try {
		await GET(event);
	} catch (thrown) {
		if (isRedirect(thrown)) return { status: thrown.status, location: thrown.location };
		throw thrown;
	}
	throw new Error('GET /impressum answered without a redirect.');
}

describe('GET /[[lang]]/impressum', () => {
	it.each(['en', 'de', 'es', 'fr'])(
		'sends /%s/impressum to the Contact legal notice',
		async (lang) => {
			expect(await redirectFor(lang)).toEqual({
				status: 308,
				location: `/${lang}/contact#legal-notice`
			});
		}
	);
});
