// @vitest-environment node

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';

/**
 * Wire contract for the cache policy on the public JWKS endpoint.
 *
 * Requests pass through the real Better Auth dispatcher with the application's
 * options, including every configured plugin and hook. This matters because a
 * user `hooks.after` runs before every plugin `hooks.after`
 * (better-auth/dist/api/dispatch.mjs, `getHooks`): only the final response proves
 * that nothing later personalizes it or sets a cookie. The sole substitution is
 * the official memoryAdapter, so these tests cover HTTP and header policy without
 * claiming a Convex storage contract.
 */

const BASE_URL = 'https://jwks-cache.test';
const CONVEX_SITE_URL = 'https://jwks-cache.convex.site';
const JWKS_URL = `${BASE_URL}/api/auth/convex/jwks`;
const EXPECTED_CACHE_CONTROL = 'public, max-age=60, must-revalidate';
const PRIVATE_JWK_PARAMETERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'];
const STORED_KEY_ID = 'jwks-cache-control-test-key';

// auth.config.ts reads CONVEX_SITE_URL while evaluating the module, so the
// environment must be ready before ../auth is imported.
vi.stubEnv('SITE_URL', BASE_URL);
vi.stubEnv('BETTER_AUTH_SECRET', 'jwks-cache-control-test-secret-value');
vi.stubEnv('CONVEX_SITE_URL', CONVEX_SITE_URL);

const { createAuthOptions } = await import('../auth');

type StoredJwk = {
	id: string;
	publicKey: string;
	privateKey: string;
	createdAt: Date;
};

/**
 * Create a real RS256 key pair under the Convex plugin's customJwt contract and
 * store it in the shape the jwt plugin writes and reads: `publicKey` and
 * `privateKey` as JSON strings plus `createdAt`. The fixture deliberately keeps
 * the private half unencrypted so a response containing key material fails the
 * leak assertions instead of hiding behind ciphertext.
 */
async function createStoredJwk(): Promise<{ stored: StoredJwk; privateJwk: JsonWebKey }> {
	const { publicKey, privateKey } = await crypto.subtle.generateKey(
		{
			name: 'RSASSA-PKCS1-v1_5',
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: 'SHA-256'
		},
		true,
		['sign', 'verify']
	);
	const privateJwk = await crypto.subtle.exportKey('jwk', privateKey);
	return {
		stored: {
			id: STORED_KEY_ID,
			publicKey: JSON.stringify(await crypto.subtle.exportKey('jwk', publicKey)),
			privateKey: JSON.stringify(privateJwk),
			createdAt: new Date()
		},
		privateJwk
	};
}

function createTestAuth(db: Record<string, unknown[]>) {
	return betterAuth({ ...createAuthOptions({} as never), database: memoryAdapter(db) });
}

async function createSeededAuth() {
	const { stored, privateJwk } = await createStoredJwk();
	return { auth: createTestAuth({ jwks: [stored] }), privateJwk };
}

afterEach(() => {
	vi.restoreAllMocks();
});

// Every test in this file needs the environment stubs above, so cleanup waits
// until the file finishes. The default isolated forks give each file its own
// process. Under `--no-isolate`, files share a process and would otherwise keep
// seeing these stubs.
afterAll(() => {
	vi.unstubAllEnvs();
});

describe('public JWKS cache policy', () => {
	it('marks the successful key set cacheable without personalizing it', async () => {
		const { auth, privateJwk } = await createSeededAuth();

		const response = await auth.handler(new Request(JWKS_URL, { method: 'GET' }));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe(EXPECTED_CACHE_CONTROL);
		expect(response.headers.getSetCookie()).toEqual([]);

		expect(body.keys).toHaveLength(1);
		const [key] = body.keys as Array<Record<string, unknown>>;
		expect(key.kid).toBe(STORED_KEY_ID);
		expect(key.kty).toBe('RSA');
		expect(key.alg).toBe('RS256');
		for (const parameter of PRIVATE_JWK_PARAMETERS) {
			expect(key).not.toHaveProperty(parameter);
		}
		expect(JSON.stringify(body)).not.toContain(privateJwk.d);
	});

	it('answers a cookie-bearing request with the identical public response', async () => {
		const { auth } = await createSeededAuth();

		const anonymous = await auth.handler(new Request(JWKS_URL, { method: 'GET' }));
		const withCookie = await auth.handler(
			new Request(JWKS_URL, {
				method: 'GET',
				headers: { cookie: '__Secure-better-auth.session_token=not-a-real-session' }
			})
		);

		expect(withCookie.status).toBe(200);
		expect(withCookie.headers.get('cache-control')).toBe(EXPECTED_CACHE_CONTROL);
		expect(withCookie.headers.getSetCookie()).toEqual([]);
		expect(await withCookie.json()).toEqual(await anonymous.json());
	});

	it('leaves the other auth endpoints on their own cache policy', async () => {
		const { auth } = await createSeededAuth();

		const openIdConfig = await auth.handler(
			new Request(`${BASE_URL}/api/auth/convex/.well-known/openid-configuration`, {
				method: 'GET'
			})
		);
		expect(openIdConfig.status).toBe(200);
		expect(openIdConfig.headers.get('cache-control')).toBeNull();

		// get-session supplies its own no-store policy, which the hook must preserve.
		const session = await auth.handler(
			new Request(`${BASE_URL}/api/auth/get-session`, { method: 'GET' })
		);
		expect(session.headers.get('cache-control')).toBe('no-store');
	});

	it('does not apply the policy to the JWKS path on another method', async () => {
		const { auth } = await createSeededAuth();

		const response = await auth.handler(new Request(JWKS_URL, { method: 'POST' }));

		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBeNull();
	});

	it('leaves a failing key set request uncached', async () => {
		// The Convex plugin turns adapter writes outside a mutation context into no-ops,
		// so an empty store cannot repair itself here and the endpoint genuinely fails.
		// Better Auth reports that through console.error. Silence it so the expected
		// failure does not look like a broken test run.
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const auth = createTestAuth({ jwks: [] });

		const response = await auth.handler(new Request(JWKS_URL, { method: 'GET' }));

		expect(response.status).toBe(500);
		expect(response.headers.get('cache-control')).toBeNull();
	});
});
