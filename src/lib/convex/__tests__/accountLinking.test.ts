// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { handleOAuthUserInfo } from 'better-auth/oauth2';

/**
 * Contract test against the installed Better Auth.
 *
 * The app enables email-and-password sign-in next to Google and GitHub. Whether
 * an OAuth sign-in may implicitly link into an existing local user is decided
 * by `account.accountLinking` and, where the app leaves it unset, by the
 * library default. Below 1.6.11 that default linked into an unverified local
 * user and set `emailVerified: true` on it, which hands a squatted address to
 * the attacker the moment the real owner signs in with the matching provider
 * (GHSA-g38m-r43w-p2q7).
 *
 * There are two ways back into that state and the guard has to cover both, so
 * these tests exercise the real `handleOAuthUserInfo` rather than a double, and
 * feed it the application's own option block rather than an empty one. Lowering
 * the dependency floor fails here; so does setting
 * `requireLocalEmailVerified: false` in auth.ts, which is the escape hatch
 * 1.6.11 added and already deprecated.
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

const { createAuthOptions } = await import('../auth');

const appOptions = createAuthOptions({} as never) as {
	account?: { accountLinking?: { trustedProviders?: unknown } };
};

/**
 * Better Auth resolves the trusted providers from this same option block
 * (`getTrustedProviders` in better-auth/dist/context/helpers.mjs), which also
 * accepts a function. The app uses neither form today, and the case below fails
 * rather than let this quietly resolve to an empty list if that changes.
 */
const configuredTrustedProviders = appOptions.account?.accountLinking?.trustedProviders;

type LinkContext = Parameters<typeof handleOAuthUserInfo>[0];
type LinkOptions = Parameters<typeof handleOAuthUserInfo>[1];

const PROVIDER_ID = 'google';

const providerAccount = {
	providerId: PROVIDER_ID,
	accountId: 'google-account-id',
	accessToken: 'access-token',
	refreshToken: 'refresh-token',
	idToken: undefined,
	accessTokenExpiresAt: undefined,
	refreshTokenExpiresAt: undefined,
	scope: 'openid email profile'
};

const providerUserInfo = {
	id: 'google-account-id',
	email: 'squatted@example.com',
	// The provider vouches for the address; the local account never did.
	emailVerified: true,
	name: 'Real Owner',
	image: undefined
};

function createContext(localUser: { id: string; email: string; emailVerified: boolean }) {
	const internalAdapter = {
		findOAuthUser: vi.fn(async () => ({
			user: localUser,
			accounts: [{ providerId: 'credential', accountId: localUser.id }],
			linkedAccount: undefined
		})),
		linkAccount: vi.fn(async () => ({ id: 'linked-account-id' })),
		updateUser: vi.fn(async () => localUser),
		updateAccount: vi.fn(async () => undefined),
		createSession: vi.fn(async () => ({ id: 'session-id', userId: localUser.id }))
	};

	const context = {
		context: {
			internalAdapter,
			trustedProviders: Array.isArray(configuredTrustedProviders) ? configuredTrustedProviders : [],
			options: { account: appOptions.account },
			baseURL: 'https://example.test/api/auth',
			secret: 'test-secret',
			logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
		}
	};

	return { context: context as unknown as LinkContext, internalAdapter };
}

const linkOptions = {
	userInfo: providerUserInfo,
	account: providerAccount,
	callbackURL: '/app',
	disableSignUp: false,
	overrideUserInfo: false
} as unknown as LinkOptions;

describe('implicit OAuth account linking', () => {
	it('resolves the trusted providers the way the context does', () => {
		// A function here would be resolved per request against the callback,
		// which this synthetic context cannot reproduce.
		expect(typeof configuredTrustedProviders).not.toBe('function');
	});

	it('refuses to link into a local user that never verified its email', async () => {
		const { context, internalAdapter } = createContext({
			id: 'local-user-id',
			email: 'squatted@example.com',
			emailVerified: false
		});

		const result = await handleOAuthUserInfo(context, linkOptions);

		expect(result.error).toBe('account not linked');
		expect(result.data).toBeNull();
		expect(internalAdapter.linkAccount).not.toHaveBeenCalled();
		// The promotion to a verified address is the actual damage.
		expect(internalAdapter.updateUser).not.toHaveBeenCalled();
		expect(internalAdapter.createSession).not.toHaveBeenCalled();
	});

	it('still links into a local user that did verify its email', async () => {
		const { context, internalAdapter } = createContext({
			id: 'local-user-id',
			email: 'squatted@example.com',
			emailVerified: true
		});

		const result = await handleOAuthUserInfo(context, linkOptions);

		expect(result.error).toBeNull();
		expect(internalAdapter.linkAccount).toHaveBeenCalledTimes(1);
		expect(internalAdapter.createSession).toHaveBeenCalledTimes(1);
	});
});
