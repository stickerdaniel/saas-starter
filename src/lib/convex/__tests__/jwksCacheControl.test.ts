// @vitest-environment node

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';

/**
 * Wire-Vertrag der Cache-Policy auf dem öffentlichen JWKS-Endpunkt.
 *
 * Die Anfragen laufen durch den echten Better-Auth-Dispatcher mit den Optionen
 * der Anwendung, also mit allen konfigurierten Plugins und deren Hooks. Das ist
 * nötig, weil ein User-`hooks.after` vor jedem Plugin-`hooks.after` läuft
 * (better-auth/dist/api/dispatch.mjs, `getHooks`): erst die fertige Antwort
 * belegt, dass danach nichts mehr personalisiert oder ein Cookie setzt.
 * Einzige Substitution ist der offizielle memoryAdapter, deshalb prüfen diese
 * Tests HTTP- und Header-Policy und behaupten keinen Convex-Speichervertrag.
 */

const BASE_URL = 'https://jwks-cache.test';
const CONVEX_SITE_URL = 'https://jwks-cache.convex.site';
const JWKS_URL = `${BASE_URL}/api/auth/convex/jwks`;
const EXPECTED_CACHE_CONTROL = 'public, max-age=60, must-revalidate';
const PRIVATE_JWK_PARAMETERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'];
const STORED_KEY_ID = 'jwks-cache-control-test-key';

// auth.config.ts liest CONVEX_SITE_URL schon beim Auswerten des Moduls, die
// Umgebung muss also vor dem Import von ../auth stehen.
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
 * Erzeugt ein echtes RS256-Schlüsselpaar nach der Vorgabe des Convex-Plugins
 * für customJwt und legt es in der Form ab, die das jwt-Plugin schreibt und
 * liest: `publicKey` und `privateKey` als JSON-Strings plus `createdAt`. Die
 * private Hälfte liegt absichtlich unverschlüsselt im Fixture, damit eine
 * Antwort mit Schlüsselmaterial an den Leak-Assertions scheitert statt sich
 * hinter Ciphertext zu verstecken.
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

// Alle Tests dieser Datei brauchen die oben gesetzten Env-Stubs, deshalb wird
// erst am Dateiende aufgeräumt. Unter dem Standard-Pool (forks, isoliert)
// bekommt ohnehin jede Datei ihren eigenen Prozess; mit `--no-isolate` teilen
// sich die Dateien einen Prozess und sähen die Stubs sonst weiter.
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

		// get-session bringt sein eigenes no-store mit; der Hook darf es nicht aufweichen.
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
		// Das Convex-Plugin macht Adapter-Writes außerhalb eines Mutation-Kontexts
		// zu No-Ops, ein leerer Speicher heilt sich hier also nicht selbst und der
		// Endpunkt scheitert echt. Better Auth protokolliert das über
		// console.error; stummgeschaltet, damit der erwartete Fehler nicht wie ein
		// kaputter Testlauf aussieht.
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const auth = createTestAuth({ jwks: [] });

		const response = await auth.handler(new Request(JWKS_URL, { method: 'GET' }));

		expect(response.status).toBe(500);
		expect(response.headers.get('cache-control')).toBeNull();
	});
});
