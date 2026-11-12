// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('varlock/auto-load', () => ({}));
vi.mock('fs', () => ({ default: { writeFileSync: vi.fn() } }));
vi.mock('convex/browser', () => ({
	ConvexHttpClient: class {
		async mutation() {
			return { success: true };
		}
	}
}));
vi.mock('../e2e/utils/site-url', () => ({ resolveSiteUrl: () => 'https://preview.example.com' }));
vi.mock('../e2e/utils/convex-url', () => ({
	waitForConvexUrl: async () => 'https://test.convex.cloud'
}));
vi.mock('../e2e/utils/backend-readiness', () => ({ waitForBackendReady: vi.fn() }));
vi.mock('../e2e/utils/preview-bypass', () => ({
	fetchVercelBypassCookie: vi.fn(),
	getPreviewBypass: () => ({ headers: { 'x-vercel-protection-bypass': 'test-bypass' } })
}));
vi.mock('../e2e/utils/owned-test-data', () => ({
	beginOwnedTestData: () => 'test-run',
	ownTestEmail: vi.fn()
}));
vi.mock('../e2e/global-teardown', () => ({ default: vi.fn() }));

import globalSetup from '../e2e/global-setup';

beforeEach(() => {
	vi.stubEnv('AUTH_E2E_TEST_SECRET', 'test-secret');
	vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

it('provisions the backend key through the preview cache before signing in', async () => {
	let provisioned = false;
	let signIns = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith('/convex/jwks')) {
				const headers = new Headers(init?.headers);
				if (headers.get('x-vercel-protection-bypass') !== 'test-bypass') {
					return new Response(null, { status: 403 });
				}
				// A preview cache can serve the previous deployment's key without
				// provisioning the fresh backend. Only revalidation reaches it.
				provisioned = headers.get('cache-control') === 'no-cache';
				return Response.json({ keys: [{ kid: 'public-test-key', kty: 'RSA' }] });
			}
			if (url.endsWith('/sign-in/email')) {
				expect(provisioned, 'Provision the backend signing key before sign-in').toBe(true);
				signIns++;
			}
			return Response.json({});
		})
	);

	await globalSetup();
	expect(signIns).toBe(2);
});

it.each([
	{ status: 200, body: JSON.stringify({ keys: [] }) },
	{ status: 200, body: '<html>Preview protection</html>' },
	{ status: 403, body: JSON.stringify({ keys: [{ kid: 'not-authorized' }] }) }
])('stops before user creation when JWKS is unusable: $status $body', async ({ status, body }) => {
	const requests: string[] = [];
	vi.stubGlobal('fetch', async (url: string) => {
		requests.push(url);
		return new Response(body, { status });
	});

	await expect(globalSetup()).rejects.toThrow('Session signing key was not provisioned');
	expect(requests).toEqual(['https://preview.example.com/api/auth/convex/jwks']);
});
