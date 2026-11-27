import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';
import * as Schema from 'effect/Schema';
import { api } from '../../src/lib/convex/_generated/api';
import { createTestAccount } from './auth';
import { resolveConvexUrl } from './convex-url';
import { ownTestEmail } from './owned-test-data';
import { resolveSiteUrl } from './site-url';
import type { TestAccount } from './types';

export const REDIRECT_URI = 'http://127.0.0.1:43111/callback';
export const BOTH_SCOPES = 'mcp:read mcp:write offline_access';

const Metadata = Schema.Struct({
	issuer: Schema.String,
	authorization_endpoint: Schema.String,
	token_endpoint: Schema.String,
	registration_endpoint: Schema.String,
	revocation_endpoint: Schema.String,
	introspection_endpoint: Schema.String,
	scopes_supported: Schema.Array(Schema.String)
});
export type Metadata = typeof Metadata.Type;
export const decodeMetadata = Schema.decodeUnknownSync(Metadata);

const TokenResponse = Schema.Struct({
	access_token: Schema.String,
	scope: Schema.String,
	refresh_token: Schema.optional(Schema.String)
});
const decodeTokens = Schema.decodeUnknownSync(TokenResponse);

const OAuthError = Schema.Struct({ error: Schema.String });
export const decodeOAuthError = Schema.decodeUnknownSync(OAuthError);

const Registration = Schema.Struct({ client_id: Schema.String });
const ConvexToken = Schema.Struct({ token: Schema.String });
const Redirect = Schema.Struct({ url: Schema.String });

export const siteUrl = () => resolveSiteUrl();

function testSecret(): string {
	const secret = process.env.AUTH_E2E_TEST_SECRET;
	if (!secret) throw new Error('OAuth specs need AUTH_E2E_TEST_SECRET');
	return secret;
}

export function convexClient(token?: string): ConvexHttpClient {
	const url = resolveConvexUrl();
	if (!url) throw new Error('OAuth specs need a Convex backend');
	const client = new ConvexHttpClient(url);
	if (token) client.setAuth(token);
	return client;
}

export const resetRegistrationLimit = () =>
	convexClient().mutation(api.tests.resetOAuthRegistrationLimit, { secret: testSecret() });

export async function fetchMetadata(request: APIRequestContext): Promise<Metadata> {
	const response = await request.get(
		`${siteUrl()}/.well-known/oauth-authorization-server/api/auth`
	);
	expect(response.status()).toBe(200);
	return decodeMetadata(await response.json());
}

export const resourceOf = (metadata: Metadata) => `${new URL(metadata.token_endpoint).origin}/mcp`;

export const register = (
	request: APIRequestContext,
	metadata: Metadata,
	name: string,
	redirectUri = REDIRECT_URI
) =>
	request.post(metadata.registration_endpoint, {
		data: {
			client_name: name,
			redirect_uris: [redirectUri],
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code']
		}
	});

export async function registerClient(
	request: APIRequestContext,
	metadata: Metadata,
	name: string,
	redirectUri = REDIRECT_URI
): Promise<string> {
	const response = await register(request, metadata, name, redirectUri);
	expect(response.status()).toBe(201);
	return Schema.decodeUnknownSync(Registration)(await response.json()).client_id;
}

export async function newAccount(label: string): Promise<TestAccount> {
	const account = {
		email: `oauth-${label}-${randomUUID()}@e2e.example.com`,
		password: 'TestPassword123!',
		name: `OAuth ${label}`
	};
	ownTestEmail(account.email, 'userEmails');
	await createTestAccount(account);
	return account;
}

export async function signInByRequest({ request }: Pick<Page, 'request'>, account: TestAccount) {
	const response = await request.post(`${siteUrl()}/api/auth/sign-in/email`, {
		headers: { Origin: siteUrl() },
		data: { email: account.email, password: account.password }
	});
	expect(response.status()).toBe(200);
}

export async function convexToken(page: Page): Promise<string> {
	const response = await page.request.get(`${siteUrl()}/api/auth/convex/token`);
	expect(response.status()).toBe(200);
	return Schema.decodeUnknownSync(ConvexToken)(await response.json()).token;
}

export type Authorization = { url: string; verifier: string };

export function authorization(
	metadata: Metadata,
	clientId: string,
	scope: string | null,
	redirectUri = REDIRECT_URI
): Authorization {
	const verifier = randomBytes(48).toString('base64url');
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: redirectUri,
		state: randomBytes(8).toString('base64url'),
		code_challenge: createHash('sha256').update(verifier).digest('base64url'),
		code_challenge_method: 'S256',
		resource: resourceOf(metadata)
	});
	if (scope !== null) params.set('scope', scope);
	return { url: `${metadata.authorization_endpoint}?${params}`, verifier };
}

const catchRedirects = (page: Page) =>
	page.route(`${REDIRECT_URI}**`, (route) => route.fulfill({ status: 200, body: 'done' }));

export async function openAuthorization(page: Page, start: Authorization, path: RegExp) {
	await page.goto(start.url);
	await expect(page).toHaveURL(path);
}

export async function openConsent(page: Page, start: Authorization) {
	await openAuthorization(page, start, /\/oauth\/consent\?/);
	await expect(page.getByRole('button', { name: 'Allow', exact: true })).toBeEnabled();
}

export async function redirectAfter(page: Page, act: () => Promise<void>): Promise<URL> {
	await catchRedirects(page);
	await act();
	await page.waitForURL((url) => url.href.startsWith(REDIRECT_URI));
	return new URL(page.url());
}

export async function allow(page: Page): Promise<string> {
	const callback = await redirectAfter(page, () =>
		page.getByRole('button', { name: 'Allow', exact: true }).click()
	);
	const code = callback.searchParams.get('code');
	if (!code) throw new Error(`No code in ${callback.search}`);
	return code;
}

export const token = (
	request: APIRequestContext,
	metadata: Metadata,
	form: Record<string, string>
) => request.post(metadata.token_endpoint, { form });

export async function exchange(
	request: APIRequestContext,
	metadata: Metadata,
	clientId: string,
	code: string,
	start: Authorization
) {
	const response = await token(request, metadata, {
		grant_type: 'authorization_code',
		code,
		redirect_uri: REDIRECT_URI,
		client_id: clientId,
		code_verifier: start.verifier,
		resource: resourceOf(metadata)
	});
	expect(response.status()).toBe(200);
	return decodeTokens(await response.json());
}

export const refresh = (
	request: APIRequestContext,
	metadata: Metadata,
	clientId: string,
	refreshToken: string
): Promise<APIResponse> =>
	token(request, metadata, {
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
		client_id: clientId,
		resource: resourceOf(metadata)
	});

export const parseTokens = async (response: APIResponse) => decodeTokens(await response.json());

export async function connectByRequest(
	page: Page,
	metadata: Metadata,
	clientId: string,
	scope = BOTH_SCOPES
) {
	const start = authorization(metadata, clientId, scope);
	const authorize = await page.request.get(start.url, { maxRedirects: 0 });
	const consentPath =
		authorize.headers()['location'] ??
		Schema.decodeUnknownSync(Redirect)(await authorize.json()).url;
	const consent = await page.request.post(`${siteUrl()}/api/auth/oauth2/consent`, {
		headers: { Origin: siteUrl() },
		data: { accept: true, oauth_query: new URL(consentPath, siteUrl()).search.slice(1) }
	});
	expect(consent.status()).toBe(200);
	const callback = new URL(Schema.decodeUnknownSync(Redirect)(await consent.json()).url);
	const code = callback.searchParams.get('code');
	if (!code) throw new Error(`No code in ${callback.search}`);
	return exchange(page.request, metadata, clientId, code, start);
}
