import { randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import * as McpClient from 'effect/ai/McpClient';
import type { McpClientError } from 'effect/ai/McpClientError';
import * as McpProtocol from 'effect/ai/McpProtocol';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import { api } from '../src/lib/convex/_generated/api';
import {
	BOTH_SCOPES,
	connectByRequest,
	convexClient,
	convexToken,
	fetchMetadata,
	newAccount,
	parseTokens,
	refresh,
	registerClient,
	resetRegistrationLimit,
	resourceOf,
	signInByRequest,
	siteUrl,
	testSecret,
	type Metadata
} from './utils/oauth';
import { test } from './utils/test';

// Cheaper layers rejected because: the bearer check runs the provider's token
// validation, the consent ceiling, the session binding and the user row of one
// deployment, the MCP layer is built when the deployment loads the HTTP module,
// and only real tokens from that deployment's authorization flow show whether
// the endpoint accepts or refuses them.

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeAll(resetRegistrationLimit);

const REVISION = '2026-07-28';
const EARLIER_REVISION = '2025-11-25';
const MAX_BODY_BYTES = 1_048_576;
const READ_TOOLS = ['get_account', 'list_community_messages'];
const ALL_TOOLS = [...READ_TOOLS, 'post_community_message'];
const FOREIGN_ORIGIN = 'https://foreign.example.test';

const firstPage = { paginationOpts: { cursor: null, numItems: 20 } };

const Account = Schema.Struct({ userId: Schema.String, email: Schema.String });
const Messages = Schema.Struct({
	messages: Schema.Array(
		Schema.Struct({ messageId: Schema.String, userId: Schema.String, body: Schema.String })
	)
});
const Posted = Schema.Struct({ messageId: Schema.String });
const Consent = Schema.Struct({ referenceId: Schema.String });
const ResourceMetadata = Schema.Struct({ scopes_supported: Schema.Array(Schema.String) });
const JsonRpcError = Schema.Struct({
	jsonrpc: Schema.Literal('2.0'),
	id: Schema.Number,
	error: Schema.Struct({ code: Schema.Number, message: Schema.String })
});

const metadataUrl = (mcp: string) =>
	`${new URL(mcp).origin}/.well-known/oauth-protected-resource/mcp`;

function rpc(method: string, params: Record<string, unknown> = {}) {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		accept: 'application/json, text/event-stream',
		'mcp-protocol-version': REVISION,
		'mcp-method': method
	};
	if (typeof params.name === 'string') headers['mcp-name'] = params.name;
	const body = {
		jsonrpc: '2.0',
		id: 1,
		method,
		params: {
			...params,
			_meta: {
				'io.modelcontextprotocol/protocolVersion': REVISION,
				'io.modelcontextprotocol/clientCapabilities': {}
			}
		}
	};
	return { headers, body: JSON.stringify(body) };
}

const bearer = (token: string | undefined): Record<string, string> =>
	token === undefined ? {} : { authorization: `Bearer ${token}` };

function postRpc(
	request: APIRequestContext,
	mcp: string,
	token: string | undefined,
	method: string,
	params?: Record<string, unknown>
) {
	const { headers, body } = rpc(method, params);
	return request.post(mcp, { headers: { ...headers, ...bearer(token) }, data: body });
}

const listStatus = async (request: APIRequestContext, mcp: string, token: string) =>
	(await postRpc(request, mcp, token, 'tools/list')).status();

function postChunked(url: string, headers: Record<string, string>, body: string) {
	const send = new URL(url).protocol === 'https:' ? httpsRequest : httpRequest;
	return new Promise<{ status: number; body: string }>((resolve, reject) => {
		const outgoing = send(url, { method: 'POST', headers }, (response) => {
			const chunks: Buffer[] = [];
			response.on('data', (chunk: Buffer) => chunks.push(chunk));
			response.on('end', () =>
				resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() })
			);
			response.on('error', reject);
		});
		outgoing.on('error', reject);
		const half = Math.floor(body.length / 2);
		outgoing.write(body.slice(0, half));
		outgoing.end(body.slice(half));
	});
}

const padded = (bytes: number) => {
	const { headers, body } = rpc('tools/list', { pad: '' });
	return {
		headers,
		body: body.replace('"pad":""', `"pad":"${'x'.repeat(bytes - body.length)}"`)
	};
};

const clientLayer = (mcp: string, token: string) =>
	McpClient.layerHttp({
		name: 'mcp-endpoint-spec',
		version: '0.0.0',
		protocol: McpProtocol.v2026_07_28,
		url: mcp,
		headers: bearer(token)
	}).pipe(Layer.provide(FetchHttpClient.layer));

const withClient = <Result>(
	mcp: string,
	token: string,
	use: (client: McpClient.McpClient) => Effect.Effect<Result, McpClientError>
) => Effect.runPromise(McpClient.McpClient.use(use).pipe(Effect.provide(clientLayer(mcp, token))));

const toolNames = (client: McpClient.McpClient) =>
	client.listTools().pipe(Effect.map((tools) => tools.map((tool) => tool.name).sort()));

const callTool = <S extends Schema.Top>(
	client: McpClient.McpClient,
	name: string,
	args: Record<string, unknown>,
	schema: S
) =>
	client.listTools().pipe(
		Effect.flatMap((tools) => {
			const tool = tools.find((listed) => listed.name === name);
			return tool === undefined
				? Effect.die(new Error(`${name} is not listed`))
				: client.callTool({ tool, schema, arguments: args });
		})
	);

async function connections(context: Pick<Page, 'request'>) {
	const owner = convexClient(await convexToken(context));
	return (await owner.query(api.oauth.connections.list, firstPage)).page;
}

async function connectionOf(context: Pick<Page, 'request'>, clientId: string) {
	const found = (await connections(context)).find((entry) => entry.clientId === clientId);
	if (!found) throw new Error(`No connection for ${clientId}`);
	return found;
}

async function revoke(context: Pick<Page, 'request'>, clientId: string) {
	const { consentId } = await connectionOf(context, clientId);
	const owner = convexClient(await convexToken(context));
	expect(await owner.mutation(api.oauth.connections.revoke, { consentId })).toEqual({
		revoked: true
	});
}

async function signedIn(context: Pick<Page, 'request'>, label: string) {
	const account = await newAccount(label);
	await signInByRequest(context, account);
	return account;
}

async function readAccess(page: Page, metadata: Metadata) {
	await signedIn(page, 'mcp-read');
	const readClient = await registerClient(page.request, metadata, 'MCP read client');
	const read = await connectByRequest(page, metadata, readClient, 'mcp:read');
	const narrowedClient = await registerClient(page.request, metadata, 'MCP narrowed client');
	const wide = await connectByRequest(page, metadata, narrowedClient, BOTH_SCOPES);
	await connectByRequest(page, metadata, narrowedClient, BOTH_SCOPES, {
		prompt: 'consent',
		accept: 'mcp:read offline_access'
	});
	return { read: read.access_token, narrowed: wide.access_token };
}

async function readToken(page: Page, metadata: Metadata, label: string) {
	await signedIn(page, label);
	const clientId = await registerClient(page.request, metadata, `MCP ${label} client`);
	return (await connectByRequest(page, metadata, clientId, 'mcp:read')).access_token;
}

test('a request without a valid bearer gets the resource_metadata challenge', async ({
	request
}) => {
	const mcp = resourceOf(await fetchMetadata(request));
	const prm = metadataUrl(mcp);
	const missing = await postRpc(request, mcp, undefined, 'tools/list');
	expect(missing.status()).toBe(401);
	expect(missing.headers()['www-authenticate']).toBe(`Bearer resource_metadata="${prm}"`);

	const random = await postRpc(request, mcp, randomBytes(32).toString('base64url'), 'tools/list');
	expect(random.status()).toBe(401);
	expect(random.headers()['www-authenticate']).toBe(
		`Bearer error="invalid_token", resource_metadata="${prm}"`
	);

	const bodyless = await request.post(mcp);
	expect(bodyless.status()).toBe(401);
	expect(bodyless.headers()['www-authenticate']).toBe(`Bearer resource_metadata="${prm}"`);
});

test('the resource metadata lists offline_access and a client that requests it gets a refresh token', async ({
	page,
	request
}) => {
	const metadata = await fetchMetadata(request);
	const mcp = resourceOf(metadata);
	const document = await request.get(metadataUrl(mcp));
	expect(document.status()).toBe(200);
	expect(
		Schema.decodeUnknownSync(ResourceMetadata)(await document.json()).scopes_supported
	).toEqual(['mcp:read', 'mcp:write', 'offline_access']);

	await signedIn(page, 'mcp-offline');
	const clientId = await registerClient(request, metadata, 'MCP offline client');
	const tokens = await connectByRequest(page, metadata, clientId, BOTH_SCOPES);
	expect(tokens.scope.split(' ').sort()).toEqual(['mcp:read', 'mcp:write', 'offline_access']);
	expect(tokens.refresh_token).toEqual(expect.any(String));
});

test('a read grant lists the read tools and gets insufficient_scope for the write tool', async ({
	page,
	request
}) => {
	const metadata = await fetchMetadata(request);
	const mcp = resourceOf(metadata);
	const tokens = await readAccess(page, metadata);
	for (const [grant, token] of Object.entries(tokens)) {
		const marker = `refused ${grant} ${randomUUID()}`;
		const denied = await postRpc(request, mcp, token, 'tools/call', {
			name: 'post_community_message',
			arguments: { body: marker }
		});
		expect(denied.status(), grant).toBe(403);
		expect(denied.headers()['www-authenticate'], grant).toBe(
			`Bearer error="insufficient_scope", scope="mcp:read mcp:write", resource_metadata="${metadataUrl(mcp)}"`
		);
		const { names, messages } = await withClient(mcp, token, (client) =>
			Effect.all({
				names: toolNames(client),
				messages: callTool(client, 'list_community_messages', {}, Messages)
			})
		);
		expect(names, grant).toEqual(READ_TOOLS);
		expect(messages.messages.map(({ body }) => body)).not.toContain(marker);
	}
});

test('a body over 1,048,576 bytes is refused after the body was read', async ({
	page,
	request
}) => {
	const metadata = await fetchMetadata(request);
	const mcp = resourceOf(metadata);
	const token = await readToken(page, metadata, 'mcp-size');
	const over = padded(MAX_BODY_BYTES + 1);
	expect(Buffer.byteLength(over.body)).toBe(MAX_BODY_BYTES + 1);

	for (const { label, headers, status } of [
		{ label: 'with a token', headers: { ...over.headers, ...bearer(token) }, status: 413 },
		{ label: 'without a token', headers: over.headers, status: 401 },
		{
			label: 'from a foreign origin',
			headers: { ...over.headers, ...bearer(token), origin: FOREIGN_ORIGIN },
			status: 403
		}
	]) {
		const sized = await request.post(mcp, { headers, data: over.body });
		expect(sized.status(), `${label}, Content-Length`).toBe(status);
		const chunked = await postChunked(mcp, headers, over.body);
		expect(chunked.status, `${label}, chunked`).toBe(status);
	}

	const exact = padded(MAX_BODY_BYTES);
	expect(Buffer.byteLength(exact.body)).toBe(MAX_BODY_BYTES);
	const passed = await request.post(mcp, {
		headers: { ...exact.headers, ...bearer(token) },
		data: exact.body
	});
	expect(passed.status()).toBe(200);
});

test('a request of an earlier protocol revision gets HTTP 400 with a JSON-RPC error', async ({
	page,
	request
}) => {
	const metadata = await fetchMetadata(request);
	const mcp = resourceOf(metadata);
	const token = await readToken(page, metadata, 'mcp-revision');
	const initialize = JSON.stringify({
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: EARLIER_REVISION,
			capabilities: {},
			clientInfo: { name: 'mcp-endpoint-spec', version: '0.0.0' }
		}
	});
	const base = {
		'content-type': 'application/json',
		accept: 'application/json, text/event-stream',
		...bearer(token)
	};
	for (const { label, headers, error } of [
		{
			label: 'without the version header',
			headers: base,
			error: { code: -32020, message: 'MCP-Protocol-Version header is required' }
		},
		{
			label: 'with the version header',
			headers: { ...base, 'mcp-protocol-version': EARLIER_REVISION },
			error: { code: -32602, message: 'Required request metadata is missing' }
		}
	]) {
		const response = await request.post(mcp, { headers, data: initialize });
		expect(response.status(), label).toBe(400);
		expect(Schema.decodeUnknownSync(JsonRpcError)(await response.json()), label).toEqual({
			jsonrpc: '2.0',
			id: 1,
			error
		});
	}
});

test('two users each read their own account', async ({ page, request }) => {
	const metadata = await fetchMetadata(request);
	const mcp = resourceOf(metadata);
	const clientId = await registerClient(request, metadata, 'MCP two users client');
	const ids = new Set<string>();
	for (const { label, context } of [
		{ label: 'mcp-first', context: page },
		{ label: 'mcp-second', context: { request } }
	]) {
		const account = await signedIn(context, label);
		const { access_token: token } = await connectByRequest(context, metadata, clientId);
		const { names, viewer } = await withClient(mcp, token, (client) =>
			Effect.all({ names: toolNames(client), viewer: callTool(client, 'get_account', {}, Account) })
		);
		expect(names).toEqual(ALL_TOOLS);
		expect(viewer.email).toBe(account.email);
		ids.add(viewer.userId);
	}
	expect(ids.size).toBe(2);
});

test('two users each post as themselves', async ({ page, request }) => {
	const usability = await convexClient().query(api.capabilities.getUsability, {});
	test.skip(
		!usability.billing.usable,
		'post_community_message needs billing configured on the backend'
	);
	const metadata = await fetchMetadata(request);
	const mcp = resourceOf(metadata);
	const clientId = await registerClient(request, metadata, 'MCP posting client');
	for (const { label, context } of [
		{ label: 'mcp-poster-one', context: page },
		{ label: 'mcp-poster-two', context: { request } }
	]) {
		await signedIn(context, label);
		const { access_token: token } = await connectByRequest(context, metadata, clientId);
		const body = `${label} ${randomUUID()}`;
		const { viewer, posted, listed } = await withClient(mcp, token, (client) =>
			Effect.all({
				viewer: callTool(client, 'get_account', {}, Account),
				posted: callTool(client, 'post_community_message', { body }, Posted),
				listed: callTool(client, 'list_community_messages', {}, Messages)
			})
		);
		expect(listed.messages.find((message) => message.messageId === posted.messageId)).toEqual({
			messageId: posted.messageId,
			userId: viewer.userId,
			body
		});
	}
});

test('a token issued for another resource or without one gets 401', async ({ page, request }) => {
	const metadata = await fetchMetadata(request);
	const mcp = resourceOf(metadata);
	await signedIn(page, 'mcp-audience');
	const foreignClient = await registerClient(request, metadata, 'MCP foreign audience client');
	const foreign = await connectByRequest(page, metadata, foreignClient, BOTH_SCOPES, {
		resource: `${siteUrl()}/api/auth/oauth2/userinfo`
	});
	const bareClient = await registerClient(request, metadata, 'MCP bare audience client');
	const bare = await connectByRequest(page, metadata, bareClient, BOTH_SCOPES, { resource: null });
	for (const token of [foreign.access_token, bare.access_token]) {
		const refused = await postRpc(request, mcp, token, 'tools/list');
		expect(refused.status()).toBe(401);
		expect(refused.headers()['www-authenticate']).toContain('error="invalid_token"');
	}
});

test('the access check accepts only the audiences its caller names', async ({ page, request }) => {
	const metadata = await fetchMetadata(request);
	const mcp = resourceOf(metadata);
	await signedIn(page, 'mcp-verify');
	const clientId = await registerClient(request, metadata, 'MCP verify client');
	const { access_token: token } = await connectByRequest(page, metadata, clientId);
	const { consentId } = await connectionOf(page, clientId);
	const consent = await page.request.get(`${siteUrl()}/api/auth/oauth2/get-consent`, {
		params: { id: consentId }
	});
	expect(consent.status()).toBe(200);
	const { referenceId } = Schema.decodeUnknownSync(Consent)(await consent.json());
	const verify = (audiences: string[]) =>
		convexClient().query(api.tests.verifyAccessToken, {
			secret: testSecret(),
			token,
			audiences
		});

	expect(await verify([`${siteUrl()}/api/auth/oauth2/userinfo`])).toBeNull();
	expect(await verify([mcp])).toMatchObject({ audience: mcp, grant: referenceId });
});

test('Revoke ends the token and a new authorization works again', async ({ page, request }) => {
	const metadata = await fetchMetadata(request);
	const mcp = resourceOf(metadata);
	await signedIn(page, 'mcp-revoke');
	const clientId = await registerClient(request, metadata, 'MCP revoked client');
	const old = await connectByRequest(page, metadata, clientId);
	expect(await listStatus(request, mcp, old.access_token)).toBe(200);

	await revoke(page, clientId);
	expect(await listStatus(request, mcp, old.access_token)).toBe(401);

	const renewed = await connectByRequest(page, metadata, clientId);
	expect(await listStatus(request, mcp, renewed.access_token)).toBe(200);
});

test('a replaced grant ends the old token of the other client', async ({ page, request }) => {
	const metadata = await fetchMetadata(request);
	const mcp = resourceOf(metadata);
	await signedIn(page, 'mcp-replaced');
	const clientX = await registerClient(request, metadata, 'MCP client X');
	const clientY = await registerClient(request, metadata, 'MCP client Y');
	const oldX = await connectByRequest(page, metadata, clientX);
	await connectByRequest(page, metadata, clientY);
	expect(await listStatus(request, mcp, oldX.access_token)).toBe(200);

	await revoke(page, clientY);
	const newX = await connectByRequest(page, metadata, clientX);
	expect((await connectionOf(page, clientX)).lastUsedAt).toBeNull();
	expect(await listStatus(request, mcp, oldX.access_token)).toBe(401);
	expect(await listStatus(request, mcp, newX.access_token)).toBe(200);
});

test('an ended session, a ban and a deletion each end the token', async ({
	page,
	request,
	workerAccounts
}) => {
	const metadata = await fetchMetadata(request);
	const mcp = resourceOf(metadata);
	const clientId = await registerClient(request, metadata, 'MCP account client');

	const sessionless = async (label: string) => {
		const account = await signedIn(page, label);
		const bound = await connectByRequest(page, metadata, clientId);
		expect(await listStatus(request, mcp, bound.access_token)).toBe(200);
		await page.request.post(`${siteUrl()}/api/auth/sign-out`, { headers: { Origin: siteUrl() } });
		expect(await listStatus(request, mcp, bound.access_token)).toBe(401);
		const refreshed = await refresh(request, metadata, clientId, bound.refresh_token ?? '');
		expect(refreshed.status()).toBe(200);
		const { access_token: token } = await parseTokens(refreshed);
		expect(await listStatus(request, mcp, token)).toBe(200);
		return { account, token };
	};

	const banned = await sessionless('mcp-banned');
	const { userId } = await withClient(mcp, banned.token, (client) =>
		callTool(client, 'get_account', {}, Account)
	);
	await signInByRequest({ request }, workerAccounts.admin);
	const admin = convexClient(await convexToken({ request }));
	await admin.mutation(api.admin.mutations.banUser, { userId, reason: 'MCP endpoint check' });
	expect(await listStatus(request, mcp, banned.token)).toBe(401);

	const deleted = await sessionless('mcp-deleted');
	const removal = await convexClient().mutation(api.tests.deleteTestUser, {
		email: deleted.account.email,
		secret: testSecret()
	});
	expect(removal.success).toBe(true);
	expect(await listStatus(request, mcp, deleted.token)).toBe(401);
});

test('the apps tab shows the last use of a connection in days', async ({ page, request }) => {
	const metadata = await fetchMetadata(request);
	const mcp = resourceOf(metadata);
	await signedIn(page, 'mcp-last-use');
	const clientId = await registerClient(request, metadata, 'MCP last use client');
	const first = await connectByRequest(page, metadata, clientId);
	await page.goto('/app/settings?tab=apps');
	await expect(page.locator('html[data-hydrated]')).toBeAttached();
	const lastUsed = page
		.getByRole('listitem')
		.filter({ has: page.getByText('MCP last use client', { exact: true }) })
		.getByRole('definition')
		.nth(1);
	await expect(lastUsed).toHaveText('Never');

	expect(await listStatus(request, mcp, first.access_token)).toBe(200);
	await expect(lastUsed).toHaveText(/^(today|yesterday)$/);
	const recorded = (await connectionOf(page, clientId)).lastUsedAt;
	expect(recorded).toEqual(expect.any(Number));
	expect(await listStatus(request, mcp, first.access_token)).toBe(200);
	expect((await connectionOf(page, clientId)).lastUsedAt).toBe(recorded);

	await revoke(page, clientId);
	await connectByRequest(page, metadata, clientId);
	await expect(lastUsed).toHaveText('Never');
});
