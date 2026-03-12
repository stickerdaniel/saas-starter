import { describe, expect, it } from 'vitest';
import { shouldBypassLanguageRedirect } from './hooks.server';

describe('hooks.server', () => {
	it('bypasses localization redirects for root discovery files and api routes', () => {
		expect(shouldBypassLanguageRedirect('/llms.txt')).toBe(true);
		expect(shouldBypassLanguageRedirect('/llms.txt/')).toBe(true);
		expect(shouldBypassLanguageRedirect('/robots.txt')).toBe(true);
		expect(shouldBypassLanguageRedirect('/robots.txt/')).toBe(true);
		expect(shouldBypassLanguageRedirect('/sitemap.xml')).toBe(true);
		expect(shouldBypassLanguageRedirect('/sitemap.xml/')).toBe(true);
		expect(shouldBypassLanguageRedirect('/api/auth/session')).toBe(true);
		expect(shouldBypassLanguageRedirect('/en/about')).toBe(false);
	});
});
