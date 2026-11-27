import { expect, type Page } from '@playwright/test';
import { submitSignInForm } from './utils/auth';
import { resolveConvexSiteUrl } from './utils/convex-url';
import {
	BOTH_SCOPES,
	allow,
	authorization,
	decodeMetadata,
	decodeOAuthError,
	exchange,
	fetchMetadata,
	newAccount,
	openAuthorization,
	openConsent,
	parseTokens,
	redirectAfter,
	refresh,
	register,
	registerClient,
	resetRegistrationLimit,
	signInByRequest,
	siteUrl,
	type Metadata
} from './utils/oauth';
import { test } from './utils/test';

// Cheaper layers rejected because: the consent page, the sign-in resume and the
// metadata routes only meet the provider, the proxy and the Convex router on a
// deployed stack, and the registration limit counts across that deployment.

const HOUR_MS = 3_600_000;
const MEASURED_61_REGISTRATIONS_MS = 29_174;
const REGISTRATIONS_UPPER_BOUND_MS = 2 * MEASURED_61_REGISTRATIONS_MS;
const REGISTRATIONS_MARGIN_MS = 30_000;
const REGISTRATION_WINDOW_MS = REGISTRATIONS_UPPER_BOUND_MS + REGISTRATIONS_MARGIN_MS;

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeAll(resetRegistrationLimit);

const scopesOf = (scope: string) => scope.split(' ').sort();

const VIEW_CAPABILITIES = [
	'See your name, email address and profile picture',
	'Read the messages in the community chat'
];
const CHANGE_CAPABILITY = 'Post messages in the community chat as you';
const HOSTED_REDIRECT_URI = 'https://mcp-client.example.com/oauth/callback';

const loopbackOrigin = (url: string) => new URL(url.replace('//localhost:', '//127.0.0.1:')).origin;

async function signedInPage(page: Page, label: string) {
	await signInByRequest(page, await newAccount(label));
}

test('a public client signs in, consents, exchanges the code and rotates its refresh token', async ({
	page,
	request
}) => {
	const metadata = await fetchMetadata(request);
	const clientId = await registerClient(request, metadata, 'Flow client');
	const account = await newAccount('flow');
	const start = authorization(metadata, clientId, BOTH_SCOPES);

	await openAuthorization(page, start, /\/signin\?/);
	await submitSignInForm(page, account.email, account.password);
	await page.waitForURL(/\/oauth\/consent\?/);
	await expect(page.getByRole('button', { name: 'Allow', exact: true })).toBeEnabled();
	await expect(page.getByRole('heading', { name: 'Flow client wants access' })).toBeVisible();
	await expect(page.getByText(`Signed in as ${account.email}`)).toBeVisible();

	const tokens = await exchange(request, metadata, clientId, await allow(page), start);
	expect(scopesOf(tokens.scope)).toEqual(scopesOf(BOTH_SCOPES));
	expect(tokens.refresh_token).toBeDefined();

	const rotated = await refresh(request, metadata, clientId, tokens.refresh_token ?? '');
	expect(rotated.status()).toBe(200);
	const next = await parseTokens(rotated);
	expect(next.refresh_token).toBeDefined();
	expect(next.refresh_token).not.toBe(tokens.refresh_token);

	const reused = await refresh(request, metadata, clientId, tokens.refresh_token ?? '');
	expect(reused.status()).toBe(400);
	expect(decodeOAuthError(await reused.json()).error).toBe('invalid_grant');
});

test('a narrowed consent stops the refresh token of the wider grant', async ({ page, request }) => {
	const metadata = await fetchMetadata(request);
	const clientId = await registerClient(request, metadata, 'Narrowed client');
	await signedInPage(page, 'narrowed');

	const wide = authorization(metadata, clientId, BOTH_SCOPES);
	await openConsent(page, wide);
	const first = await exchange(request, metadata, clientId, await allow(page), wide);
	expect(scopesOf(first.scope)).toEqual(scopesOf(BOTH_SCOPES));

	const again = authorization(metadata, clientId, BOTH_SCOPES);
	const narrow = { ...again, url: `${again.url}&prompt=consent` };
	await openConsent(page, narrow);
	await page.getByRole('checkbox', { name: CHANGE_CAPABILITY }).uncheck();
	const second = await exchange(request, metadata, clientId, await allow(page), narrow);
	expect(scopesOf(second.scope)).toEqual(['mcp:read', 'offline_access']);

	const stale = await refresh(request, metadata, clientId, first.refresh_token ?? '');
	expect(stale.status()).toBe(400);
	expect(decodeOAuthError(await stale.json()).error).toBe('invalid_grant');

	const current = await refresh(request, metadata, clientId, second.refresh_token ?? '');
	expect(current.status()).toBe(200);
	expect(scopesOf((await parseTokens(current)).scope)).toEqual(['mcp:read', 'offline_access']);
});

test('a passkey sign-in resumes the authorization at the consent page', async ({
	page,
	request
}) => {
	const metadata = await fetchMetadata(request);
	const clientId = await registerClient(request, metadata, 'Passkey client');
	const account = await newAccount('passkey');
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
	await signInByRequest(page, account);
	await page.goto('/en/app/settings?tab=security');
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await page.getByRole('button', { name: 'Add Passkey', exact: true }).click();
	await expect
		.poll(async () =>
			(await page.request.get(`${siteUrl()}/api/auth/passkey/list-user-passkeys`)).json()
		)
		.toHaveLength(1);
	await page.goto('about:blank');
	await page.request.post(`${siteUrl()}/api/auth/sign-out`, { headers: { Origin: siteUrl() } });
	await page.context().clearCookies();

	await openAuthorization(page, authorization(metadata, clientId, BOTH_SCOPES), /\/signin\?/);
	await page.getByRole('button', { name: 'Sign in with Passkey', exact: true }).click();
	await page.waitForURL(/\/oauth\/consent\?/);
	await expect(page.getByRole('heading', { name: 'Passkey client wants access' })).toBeVisible();
	await expect(page.getByText(`Signed in as ${account.email}`)).toBeVisible();
});

test('Deny returns access_denied to the redirect URI', async ({ page, request }) => {
	const metadata = await fetchMetadata(request);
	const clientId = await registerClient(request, metadata, 'Denied client');
	await signedInPage(page, 'deny');

	await openConsent(page, authorization(metadata, clientId, BOTH_SCOPES));
	const callback = await redirectAfter(page, () =>
		page.getByRole('button', { name: 'Deny', exact: true }).click()
	);
	expect(callback.searchParams.get('error')).toBe('access_denied');
	expect(callback.searchParams.has('code')).toBe(false);
});

test('the chosen level and the requested scopes decide the scopes of the token', async ({
	page,
	request
}) => {
	const metadata = await fetchMetadata(request);
	await signedInPage(page, 'scopes');
	const change = page.getByRole('checkbox', { name: CHANGE_CAPABILITY });
	const views = VIEW_CAPABILITIES.map((name) => page.getByRole('checkbox', { name }));

	const consentAs = async (scope: string | null, choose?: 'view') => {
		const clientId = await registerClient(request, metadata, 'Scoped client');
		const start = authorization(metadata, clientId, scope);
		await openConsent(page, start);
		if (choose === 'view') await change.uncheck();
		return exchange(request, metadata, clientId, await allow(page), start);
	};

	await openConsent(
		page,
		authorization(metadata, await registerClient(request, metadata, 'Scoped client'), BOTH_SCOPES)
	);
	await expect(change).toBeEnabled();
	await expect(change).toBeChecked();
	for (const view of views) await expect(view).toBeChecked();

	const narrowed = await consentAs(BOTH_SCOPES, 'view');
	expect(scopesOf(narrowed.scope)).toEqual(['mcp:read', 'offline_access']);

	const both = await consentAs(BOTH_SCOPES);
	expect(scopesOf(both.scope)).toEqual(scopesOf(BOTH_SCOPES));

	const withoutRefresh = await consentAs('mcp:read mcp:write', 'view');
	expect(scopesOf(withoutRefresh.scope)).toEqual(['mcp:read']);
	expect(withoutRefresh.refresh_token).toBeUndefined();

	await openConsent(
		page,
		authorization(metadata, await registerClient(request, metadata, 'Scoped client'), 'mcp:read')
	);
	await expect(change).toBeDisabled();
	await expect(change).not.toBeChecked();

	await openConsent(
		page,
		authorization(metadata, await registerClient(request, metadata, 'Scoped client'), null)
	);
	await expect(change).toBeEnabled();
	await expect(change).toBeChecked();

	await openConsent(
		page,
		authorization(metadata, await registerClient(request, metadata, 'Scoped client'), '')
	);
	await expect(page.getByText('Scoped client gets no access to your data.')).toBeVisible();
	await expect(page.getByRole('checkbox')).toHaveCount(0);
	await expect(page.getByRole('list')).toHaveCount(0);
});

test('the consent page names every capability under its level and where the access goes', async ({
	page,
	request
}) => {
	const metadata = await fetchMetadata(request);
	await signedInPage(page, 'capabilities');
	const rows = page.getByRole('list', { name: 'Permissions' }).getByRole('listitem');
	const row = (sentence: string, level: string) => new RegExp(`^\\s*${sentence}\\s+${level}\\s*$`);
	const levels = [
		...VIEW_CAPABILITIES.map((sentence) => row(sentence, 'View')),
		row(CHANGE_CAPABILITY, 'Change')
	];

	for (const scope of [BOTH_SCOPES, 'mcp:read']) {
		await openConsent(
			page,
			authorization(metadata, await registerClient(request, metadata, 'Listed client'), scope)
		);
		await expect(rows).toHaveText([...levels, /^\s*An app on this device gets this access\s*$/]);
	}

	const hosted = await registerClient(request, metadata, 'Listed client', HOSTED_REDIRECT_URI);
	await openConsent(page, authorization(metadata, hosted, BOTH_SCOPES, HOSTED_REDIRECT_URI));
	await expect(rows).toHaveText([...levels, /^\s*mcp-client\.example\.com gets this access\s*$/]);
});

test('every authorization server metadata URL serves the rewritten document', async ({
	request
}) => {
	const site = siteUrl();
	const convexSite = resolveConvexSiteUrl();
	if (!convexSite) throw new Error('The metadata test needs the Convex site URL');
	const convexOrigin = loopbackOrigin(convexSite);
	const urls = [
		`${site}/.well-known/oauth-authorization-server/api/auth`,
		`${site}/api/auth/.well-known/oauth-authorization-server`,
		`${convexSite}/.well-known/oauth-authorization-server/api/auth`,
		`${convexSite}/api/auth/.well-known/oauth-authorization-server`
	];
	const documents: Metadata[] = [];
	for (const url of urls) {
		const response = await request.get(url, { maxRedirects: 0 });
		expect(response.status(), url).toBe(200);
		documents.push(decodeMetadata(await response.json()));
	}
	for (const [index, document] of documents.entries()) {
		expect(document.issuer, urls[index]).toBe(`${site}/api/auth`);
		expect(document.authorization_endpoint, urls[index]).toBe(`${site}/api/auth/oauth2/authorize`);
		expect(
			[
				document.token_endpoint,
				document.registration_endpoint,
				document.revocation_endpoint,
				document.introspection_endpoint
			].map(loopbackOrigin),
			urls[index]
		).toEqual([convexOrigin, convexOrigin, convexOrigin, convexOrigin]);
		expect(document.scopes_supported, urls[index]).toContain('offline_access');
	}

	const otherIssuer = await request.get(
		`${site}/.well-known/oauth-authorization-server/api/other`,
		{ maxRedirects: 0 }
	);
	expect(otherIssuer.status()).toBe(404);
});

test('a signed-in user reaches none of the client management endpoints', async ({ request }) => {
	const clientId = await registerClient(request, await fetchMetadata(request), 'Managed client');
	await signInByRequest({ request }, await newAccount('client-management'));
	const endpoints = [
		{
			path: 'create-client',
			data: {
				client_name: 'Managed client',
				redirect_uris: ['https://app.example.com/callback'],
				token_endpoint_auth_method: 'none'
			}
		},
		{ path: 'update-client', data: { client_id: clientId, update: { client_name: 'Renamed' } } },
		{ path: 'client/rotate-secret', data: { client_id: clientId } },
		{ path: 'delete-client', data: { client_id: clientId } },
		{ path: `get-client?client_id=${clientId}` },
		{ path: 'get-clients' }
	];
	for (const { path, data } of endpoints) {
		const url = `${siteUrl()}/api/auth/oauth2/${path}`;
		const response = data
			? await request.post(url, { headers: { Origin: siteUrl() }, data })
			: await request.get(url);
		expect({ status: response.status(), body: await response.text() }, path).toEqual({
			status: 404,
			body: 'Not Found'
		});
	}
});

test('registration refuses a client name longer than 100 characters', async ({ request }) => {
	const metadata = await fetchMetadata(request);
	const refused = await register(request, metadata, 'n'.repeat(101));
	expect(refused.status()).toBe(400);
	expect(decodeOAuthError(await refused.json()).error).toBe('invalid_client_metadata');
	expect((await register(request, metadata, 'n'.repeat(100))).status()).toBe(201);
});

test('registration admits 60 clients per clock hour and refuses the 61st', async ({ request }) => {
	test.setTimeout(2 * REGISTRATION_WINDOW_MS + 30_000);
	const metadata = await fetchMetadata(request);
	try {
		await resetRegistrationLimit();
		const left = HOUR_MS - (Date.now() % HOUR_MS);
		if (left < REGISTRATION_WINDOW_MS) {
			await new Promise((resolve) => setTimeout(resolve, left + 1_000));
		}
		const hour = Math.floor(Date.now() / HOUR_MS);
		for (let index = 1; index <= 60; index++) {
			const response = await register(request, metadata, `Limit client ${index}`);
			expect(response.status(), `registration ${index}`).toBe(201);
		}
		expect(Math.floor(Date.now() / HOUR_MS)).toBe(hour);
		const refused = await register(request, metadata, 'Limit client 61');
		expect(refused.status()).toBe(429);
	} finally {
		await resetRegistrationLimit();
	}
});
