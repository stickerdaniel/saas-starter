// @vitest-environment node

import { parseUserInput } from 'better-auth/db';
import { describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LANGUAGES } from '../../i18n/languages';

/**
 * `authClient.updateUser({ locale })` and sign-up both run the saved `locale`
 * through Better Auth's `parseUserInput` with the production options. The
 * options come from `createAuthOptions` itself, so the test measures what the
 * routes enforce rather than a copy of the field definition. Better Auth caches
 * field definitions per options object, so each call builds a fresh one.
 */

vi.mock('../_generated/api', () => ({
	components: { betterAuth: {} },
	internal: { auth: {}, emails: { send: {} } }
}));
vi.mock('../_generated/server', () => ({
	env: { SITE_URL: 'https://example.test', BETTER_AUTH_SECRET: 'test-secret' },
	query: (definition: unknown) => definition,
	mutation: (definition: unknown) => definition,
	internalMutation: (definition: unknown) => definition
}));

async function parseUser(user: Record<string, unknown>, action: 'create' | 'update') {
	const { createAuthOptions } = await import('../auth');
	return parseUserInput(createAuthOptions({} as never), user, action);
}

async function rejectionOf(locale: unknown) {
	try {
		await parseUser({ locale }, 'update');
	} catch (error) {
		return error as { status?: unknown; body?: { code?: unknown } };
	}
	throw new Error(`locale ${JSON.stringify(locale)} was accepted`);
}

describe('saved user locale', () => {
	it.each(SUPPORTED_LANGUAGES.map((language) => language.code))(
		'accepts the supported code %s',
		async (code) => {
			expect(await parseUser({ locale: code }, 'update')).toEqual({ locale: code });
		}
	);

	it('accepts null', async () => {
		expect(await parseUser({ locale: null }, 'update')).toEqual({ locale: null });
	});

	it.each([['unsupported-locale-probe'], [''], ['DE'], [42]])(
		'rejects %j as a validation error',
		async (locale) => {
			const error = await rejectionOf(locale);
			expect(error.status).toBe('BAD_REQUEST');
			expect(error.body?.code).toBe('VALIDATION_ERROR');
		}
	);

	it('defaults a new user without a locale to English', async () => {
		expect(await parseUser({}, 'create')).toMatchObject({ locale: 'en' });
	});

	it('leaves the locale untouched on an update that omits it', async () => {
		expect(await parseUser({}, 'update')).not.toHaveProperty('locale');
	});
});
