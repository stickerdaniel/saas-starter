// @vitest-environment node

import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { load } from './+page';

/** The status and Location the page load redirects to for these route params. */
async function redirectFor(lang: string | undefined) {
	const event = { params: { lang } } as Parameters<typeof load>[0];
	try {
		await load(event);
	} catch (thrown) {
		if (isRedirect(thrown)) return { status: thrown.status, location: thrown.location };
		throw thrown;
	}
	throw new Error('/impressum loaded without a redirect.');
}

describe('/[[lang]]/impressum', () => {
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
