import { describe, expect, it, vi } from 'vitest';
import { handleOAuthUserInfo } from 'better-auth/oauth2';

/**
 * Contract test against the installed Better Auth.
 *
 * The app enables email-and-password sign-in next to Google and GitHub, and it
 * does not configure `account.accountLinking`. Whether an OAuth sign-in may
 * implicitly link into an existing local user is therefore decided entirely by
 * the library default. Below 1.6.11 that default linked into an unverified
 * local user and set `emailVerified: true` on it, which hands a squatted
 * address to the attacker the moment the real owner signs in with the matching
 * provider (GHSA-g38m-r43w-p2q7).
 *
 * These tests exercise the real `handleOAuthUserInfo` rather than a double, so
 * lowering the dependency floor again fails here instead of in production.
 */

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
			// Neither provider is trusted by name, matching the app configuration.
			trustedProviders: [],
			options: {},
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
