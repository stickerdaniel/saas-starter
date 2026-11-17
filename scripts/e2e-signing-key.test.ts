// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const events = vi.hoisted((): string[] => []);

vi.mock('varlock/auto-load', () => ({}));
vi.mock('../e2e/utils/site-url', () => ({ resolveSiteUrl: () => 'https://preview.example.com' }));
vi.mock('../e2e/utils/convex-url', () => ({
	waitForConvexUrl: async () => 'https://test.convex.cloud'
}));
vi.mock('../e2e/utils/backend-readiness', () => ({ waitForBackendReady: vi.fn() }));
vi.mock('../e2e/utils/preview-bypass', () => ({
	fetchVercelBypassCookie: vi.fn(),
	getPreviewBypass: () => ({ headers: { 'x-vercel-protection-bypass': 'test-bypass' } })
}));
// Opening the ledger is the moment workers may start signing in.
vi.mock('../e2e/utils/owned-test-data', () => ({
	beginOwnedTestData: () => {
		events.push('ledger opened');
		return 'test-run';
	}
}));

import globalSetup from '../e2e/global-setup';

beforeEach(() => {
	events.length = 0;
	vi.stubEnv('AUTH_E2E_TEST_SECRET', 'test-secret');
	vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

it('provisions the backend key through the preview cache before workers can sign in', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			if (!url.endsWith('/convex/jwks')) throw new Error(`Unexpected request ${url}`);
			const headers = new Headers(init?.headers);
			if (headers.get('x-vercel-protection-bypass') !== 'test-bypass') {
				return new Response(null, { status: 403 });
			}
			// A preview cache can serve the previous deployment's key without
			// provisioning the fresh backend. Only revalidation reaches it.
			if (headers.get('cache-control') === 'no-cache') events.push('key provisioned');
			return Response.json({ keys: [{ kid: 'public-test-key', kty: 'RSA' }] });
		})
	);

	await globalSetup();
	expect(events).toEqual(['key provisioned', 'ledger opened']);
});

it.each([
	{ status: 200, body: JSON.stringify({ keys: [] }) },
	{ status: 200, body: '<html>Preview protection</html>' },
	{ status: 403, body: JSON.stringify({ keys: [{ kid: 'not-authorized' }] }) }
])(
	'stops before opening the run when JWKS is unusable: $status $body',
	async ({ status, body }) => {
		const requests: string[] = [];
		vi.stubGlobal('fetch', async (url: string) => {
			requests.push(url);
			return new Response(body, { status });
		});

		await expect(globalSetup()).rejects.toThrow('Session signing key was not provisioned');
		expect(requests).toEqual(['https://preview.example.com/api/auth/convex/jwks']);
		expect(events).toEqual([]);
	}
);
