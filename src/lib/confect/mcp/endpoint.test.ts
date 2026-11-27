// @vitest-environment node
import { MutationRunner, QueryRunner } from '@confect/server';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import * as HttpRouter from 'effect/http/HttpRouter';
import * as HttpServer from 'effect/http/HttpServer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimited } from '../../effect/errors';
import refs from '../_generated/refs';
import { McpAccess, type AccessDecision } from './access';
import { MAX_BODY_BYTES, mcpRoutes, type McpRoutesOptions } from './endpoint';
import { AppToolkit } from './toolkit';

const SITE = 'https://app.example.test';
const CONVEX_SITE = 'https://deployment.example.test';
const MCP_URL = `${CONVEX_SITE}/mcp`;
const METADATA_URL = `${CONVEX_SITE}/.well-known/oauth-protected-resource/mcp`;
const REVISION = '2026-07-28';
const READ = ['mcp:read'];
const READ_WRITE = ['mcp:read', 'mcp:write'];
const READ_TOOLS = ['get_account', 'list_community_messages'];
const ALL_TOOLS = [...READ_TOOLS, 'post_community_message'];
const WRITE_CHALLENGE = `Bearer error="insufficient_scope", scope="mcp:read mcp:write", resource_metadata="${METADATA_URL}"`;

const USER = {
	_id: 'user-1',
	_creationTime: 1,
	name: 'Ada',
	email: 'ada@example.test',
	emailVerified: true,
	createdAt: 1,
	updatedAt: 1
};

type Principal = { readonly userId: string; readonly scopes: readonly string[] };

type Stubs = {
	readonly scopes: readonly string[];
	readonly userId?: string;
	readonly principals?: Readonly<Record<string, Principal>>;
	readonly useRecordedAt?: number | null;
	readonly viewer?: unknown;
	readonly sendAs?: (args: unknown) => Promise<unknown>;
};

const verifiedToken = Schema.decodeUnknownSync(Schema.Struct({ token: Schema.String }));

const backend = ({
	scopes,
	userId = USER._id,
	principals = {},
	useRecordedAt = Date.now(),
	viewer = USER,
	sendAs = () => Promise.resolve({ messageId: 'message-1' })
}: Stubs) => {
	const calls: string[] = [];
	const sent: unknown[] = [];
	const runQuery = vi.fn();
	runQuery.mockImplementation(
		(reference: FunctionReference<'query', 'internal'>, args: unknown) => {
			const name = getFunctionName(reference);
			calls.push(name);
			switch (name) {
				case 'oauth/access:verify':
					return Promise.resolve({
						...(principals[verifiedToken(args).token] ?? { userId, scopes }),
						clientId: 'client-1',
						expiresAt: Date.now() + 3_600_000,
						grant: '0',
						audience: MCP_URL,
						useRecordedAt
					});
				case 'users:viewerAs':
					return Promise.resolve(viewer);
				case 'messages:listAs':
					return Promise.resolve([]);
			}
			return Promise.reject(new Error(`unexpected query ${name}`));
		}
	);
	const runMutation = vi.fn();
	runMutation.mockImplementation(
		(reference: FunctionReference<'mutation', 'internal'>, args: unknown) => {
			const name = getFunctionName(reference);
			calls.push(name);
			switch (name) {
				case 'oauth/connections:recordUse':
					return Promise.resolve(null);
				case 'messages:sendAs':
					sent.push(args);
					return sendAs(args);
			}
			return Promise.reject(new Error(`unexpected mutation ${name}`));
		}
	);
	const context = Layer.mergeAll(
		QueryRunner.layer(runQuery),
		MutationRunner.layer(runMutation)
	).pipe(Layer.build, Effect.scoped, Effect.runSync);
	const count = (name: string) => calls.filter((call) => call === name).length;
	return { context, sent, count };
};

const endpoint = (stubs: Stubs, options?: McpRoutesOptions) => {
	const { handler } = HttpRouter.toWebHandler(
		mcpRoutes(refs, options).pipe(Layer.provide(HttpServer.layerServices)),
		{ disableLogger: true }
	);
	const server = backend(stubs);
	return { ...server, handle: (request: Request) => handler(request, server.context) };
};

type Rpc = {
	readonly method: string;
	readonly params?: Record<string, unknown>;
	readonly headers?: Record<string, string>;
	readonly signal?: AbortSignal;
};

const routingHeaders = (method: string, params: Record<string, unknown>) => ({
	'mcp-method': method,
	...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {})
});

const envelope = (method: string, params: Record<string, unknown>) =>
	JSON.stringify({
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
	});

const baseHeaders = {
	authorization: 'Bearer token',
	'content-type': 'application/json',
	accept: 'application/json, text/event-stream',
	'mcp-protocol-version': REVISION
};

const post = (body: string, headers: Record<string, string>, signal?: AbortSignal) =>
	new Request(MCP_URL, {
		method: 'POST',
		headers: { ...baseHeaders, ...headers },
		body,
		signal
	});

const rpc = ({ method, params = {}, headers = {}, signal }: Rpc) =>
	post(envelope(method, params), { ...routingHeaders(method, params), ...headers }, signal);

const callWrite = (headers: Record<string, string> = {}) =>
	rpc({
		method: 'tools/call',
		params: { name: 'post_community_message', arguments: { body: 'hello' } },
		headers
	});

const ToolList = Schema.Struct({
	result: Schema.Struct({
		tools: Schema.Array(
			Schema.Struct({
				name: Schema.String,
				title: Schema.optional(Schema.String),
				annotations: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
			})
		)
	})
});

const CallResult = Schema.Struct({
	result: Schema.Struct({
		isError: Schema.Boolean,
		structuredContent: Schema.optional(Schema.Unknown),
		content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String }))
	})
});

const JsonRpcError = Schema.Struct({
	error: Schema.Struct({ code: Schema.Number, message: Schema.String })
});

const decodeList = Schema.decodeUnknownSync(Schema.fromJsonString(ToolList));
const decodeCall = Schema.decodeUnknownSync(Schema.fromJsonString(CallResult));
const decodeError = Schema.decodeUnknownOption(Schema.fromJsonString(JsonRpcError));

const errorCode = (body: string) =>
	Option.getOrNull(Option.map(decodeError(body), ({ error }) => error.code));

const listedTools = async (handle: (request: Request) => Promise<Response>) => {
	const response = await handle(rpc({ method: 'tools/list' }));
	expect(response.status).toBe(200);
	return decodeList(await response.text()).result.tools;
};

const listedNames = async (handle: (request: Request) => Promise<Response>) =>
	(await listedTools(handle)).map((tool) => tool.name).sort();

const refusingWrites = Layer.succeed(
	McpAccess,
	McpAccess.of({
		decide: (tool): AccessDecision =>
			tool.name === 'post_community_message' ? { _tag: 'Refused' } : { _tag: 'Allowed' }
	})
);

beforeEach(() => {
	vi.stubEnv('SITE_URL', SITE);
	vi.stubEnv('CONVEX_SITE_URL', CONVEX_SITE);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('tool list', () => {
	it('follows the scopes of the principal', async () => {
		expect(await listedNames(endpoint({ scopes: READ }).handle)).toEqual(READ_TOOLS);
		expect(await listedNames(endpoint({ scopes: READ_WRITE }).handle)).toEqual(ALL_TOOLS);
	});

	it('lists each tool with its title at both places and the four hints', async () => {
		const tools = await listedTools(endpoint({ scopes: READ_WRITE }).handle);
		expect(tools).toHaveLength(3);
		for (const tool of tools) {
			expect(tool.title, tool.name).toEqual(expect.any(String));
			expect(tool.annotations?.title, tool.name).toBe(tool.title);
			for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
				expect(tool.annotations, `${tool.name} ${hint}`).toHaveProperty(hint, expect.any(Boolean));
			}
		}
	});
});

describe('tool result', () => {
	it('returns the account as structured content and as one JSON text block', async () => {
		const response = await endpoint({ scopes: READ }).handle(
			rpc({ method: 'tools/call', params: { name: 'get_account', arguments: {} } })
		);
		const account = { userId: USER._id, name: USER.name, email: USER.email, image: null };
		expect(decodeCall(await response.text()).result).toEqual({
			isError: false,
			structuredContent: account,
			content: [{ type: 'text', text: JSON.stringify(account) }]
		});
	});

	it('serves each request of one handler as its own principal', async () => {
		const server = endpoint({
			scopes: [],
			principals: {
				first: { userId: 'user-1', scopes: READ_WRITE },
				second: { userId: 'user-2', scopes: READ_WRITE },
				reader: { userId: 'user-3', scopes: READ }
			}
		});
		const as = (token: string) => ({ authorization: `Bearer ${token}` });
		const listed = async (token: string) => {
			const response = await server.handle(rpc({ method: 'tools/list', headers: as(token) }));
			return decodeList(await response.text())
				.result.tools.map((tool) => tool.name)
				.sort();
		};

		expect(await listed('first')).toEqual(ALL_TOOLS);
		expect(await listed('reader')).toEqual(READ_TOOLS);
		const statuses = [];
		for (const token of ['first', 'second', 'reader']) {
			statuses.push((await server.handle(callWrite(as(token)))).status);
		}
		expect(statuses).toEqual([200, 200, 403]);
		expect(server.sent).toEqual([
			{ userId: 'user-1', body: 'hello' },
			{ userId: 'user-2', body: 'hello' }
		]);
	});
});

describe('tool errors', () => {
	const send = (sendAs: () => Promise<unknown>) =>
		endpoint({ scopes: READ_WRITE, sendAs }).handle(callWrite());

	it('returns a declared failure of the twin as a tool error with its code', async () => {
		const response = await send(() =>
			Promise.reject(new ConvexError({ code: 'RATE_LIMITED', retryAfter: 30_000 }))
		);
		const { result } = decodeCall(await response.text());
		expect(result.isError).toBe(true);
		expect(result.content).toHaveLength(1);
		expect(result.content[0]?.text).toContain('RATE_LIMITED');
	});

	it.each([
		[
			'a defect that carries a declared tag',
			() => Promise.reject(new RateLimited({ retryAfter: 987_654_000 }))
		],
		['a plain defect', () => Promise.reject(new Error('defect detail 987654'))]
	])('returns %s as an internal error without its message', async (_label, sendAs) => {
		const body = await (await send(sendAs)).text();
		expect(decodeCall(body).result).toEqual({
			isError: true,
			content: [{ type: 'text', text: 'Tool execution failed due to an internal server error.' }]
		});
		expect(body).not.toContain('987654');
	});
});

describe('origin policy', () => {
	it('serves a request without Origin', async () => {
		expect((await endpoint({ scopes: READ }).handle(rpc({ method: 'tools/list' }))).status).toBe(
			200
		);
	});

	it('serves the app origin with CORS headers', async () => {
		const response = await endpoint({ scopes: READ }).handle(
			rpc({ method: 'tools/list', headers: { origin: SITE } })
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('access-control-allow-origin')).toBe(SITE);
		expect(response.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate');
		expect(response.headers.get('access-control-allow-credentials')).toBeNull();
	});

	it.each(['https://foreign.example.test', 'null', 'not a url'])(
		'refuses the Origin %s before the token check',
		async (origin) => {
			const server = endpoint({ scopes: READ });
			const response = await server.handle(rpc({ method: 'tools/list', headers: { origin } }));
			expect(response.status).toBe(403);
			expect(server.count('oauth/access:verify')).toBe(0);
		}
	);

	it('answers a preflight from the app origin with the methods and request headers', async () => {
		const response = await endpoint({ scopes: READ }).handle(
			new Request(MCP_URL, {
				method: 'OPTIONS',
				headers: { origin: SITE, 'access-control-request-method': 'POST' }
			})
		);
		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-origin')).toBe(SITE);
		expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
		expect(response.headers.get('access-control-allow-headers')?.split(', ')).toEqual([
			'Authorization',
			'Content-Type',
			'MCP-Protocol-Version',
			'Mcp-Method',
			'Mcp-Name'
		]);
	});
});

describe('scope check', () => {
	it('answers a call of the write tool beyond the scopes with the challenge', async () => {
		const server = endpoint({ scopes: READ });
		const response = await server.handle(callWrite());
		expect(response.status).toBe(403);
		expect(response.headers.get('www-authenticate')).toBe(WRITE_CHALLENGE);
		expect(server.count('messages:sendAs')).toBe(0);
	});

	it('checks the name the layer dispatches on when the body repeats the key', async () => {
		const server = endpoint({ scopes: READ });
		const body = envelope('tools/call', { name: 'post_community_message', arguments: {} }).replace(
			'"params":{',
			'"params":{"name":"get_account",'
		);
		expect(body.indexOf('"get_account"')).toBeLessThan(body.indexOf('"post_community_message"'));
		const response = await server.handle(
			post(body, routingHeaders('tools/call', { name: 'post_community_message' }))
		);
		expect(response.status).toBe(403);
		expect(response.headers.get('www-authenticate')).toBe(WRITE_CHALLENGE);
		expect(server.count('messages:sendAs')).toBe(0);
	});

	it('leaves a name header that disagrees with the body to the layer', async () => {
		const server = endpoint({ scopes: READ });
		const response = await server.handle(callWrite({ 'mcp-name': 'get_account' }));
		expect(response.status).toBe(400);
		expect(server.count('messages:sendAs')).toBe(0);
	});

	it('keeps the write tool hidden from a call that passes the check in Base64 form', async () => {
		const server = endpoint({ scopes: READ });
		const encoded = `=?base64?${Buffer.from('post_community_message').toString('base64')}?=`;
		const response = await server.handle(callWrite({ 'mcp-name': encoded }));
		expect({
			status: response.status,
			error: errorCode(await response.text()),
			sends: server.count('messages:sendAs')
		}).toEqual({ status: 200, error: -32602, sends: 0 });
	});

	it('leaves a batch that calls the write tool to the layer', async () => {
		const server = endpoint({ scopes: READ });
		const call = JSON.parse(
			envelope('tools/call', { name: 'post_community_message', arguments: { body: 'hello' } })
		);
		const response = await server.handle(
			post(JSON.stringify([call]), routingHeaders('tools/call', call.params))
		);
		expect(response.status).toBe(400);
		expect(server.count('messages:sendAs')).toBe(0);
	});
});

describe('downstream rule', () => {
	it('hides and refuses a tool that the access rule refuses despite both scopes', async () => {
		const server = endpoint({ scopes: READ_WRITE }, { access: refusingWrites });
		expect(await listedNames(server.handle)).toEqual(READ_TOOLS);
		const response = await server.handle(callWrite());
		expect({
			status: response.status,
			error: errorCode(await response.text()),
			sends: server.count('messages:sendAs')
		}).toEqual({ status: 200, error: -32602, sends: 0 });
	});
});

describe('last use', () => {
	it('records no use for a principal whose use was recorded within the hour', async () => {
		const server = endpoint({ scopes: READ, useRecordedAt: Date.now() - 60_000 });
		await server.handle(rpc({ method: 'tools/list' }));
		await server.handle(rpc({ method: 'tools/list' }));
		expect(server.count('oauth/connections:recordUse')).toBe(0);
	});

	it.each([
		['no recorded use', null],
		['a use older than an hour', Date.now() - 3_700_000]
	])('records one use per request for %s', async (_label, useRecordedAt) => {
		const server = endpoint({ scopes: READ, useRecordedAt });
		await server.handle(rpc({ method: 'tools/list' }));
		expect(server.count('oauth/connections:recordUse')).toBe(1);
	});
});

const marker = () => {
	let fire = () => {};
	const fired = new Promise<void>((resolve) => {
		fire = resolve;
	});
	return { fire, fired };
};

const deadline = (milliseconds: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, milliseconds);
	});

const slowHandlers = () => {
	const started = marker();
	const events: string[] = [];
	const onInterrupt = Effect.onInterrupt(() => Effect.sync(() => events.push('interrupted')));
	const handlers = AppToolkit.toLayer({
		get_account: () => Effect.sync(started.fire).pipe(Effect.andThen(Effect.never), onInterrupt),
		list_community_messages: () => Effect.succeed({ messages: [] }).pipe(onInterrupt),
		post_community_message: () => Effect.succeed({ messageId: 'message-1' }).pipe(onInterrupt)
	});
	return { handlers, started, events };
};

describe('aborted request', () => {
	it('interrupts the handler before the response settles', async () => {
		const { handlers, started, events } = slowHandlers();
		const { handle } = endpoint({ scopes: READ }, { handlers });
		const controller = new AbortController();
		const settled = handle(
			rpc({
				method: 'tools/call',
				params: { name: 'get_account', arguments: {} },
				signal: controller.signal
			})
		).then(
			() => events.push('settled'),
			() => events.push('settled')
		);
		await started.fired;
		controller.abort();
		await Promise.race([settled, deadline(2_000)]);
		expect(events).toEqual(['interrupted', 'settled']);
	});

	it('records no interruption for a completed call', async () => {
		const { handlers, events } = slowHandlers();
		const response = await endpoint({ scopes: READ }, { handlers }).handle(
			rpc({ method: 'tools/call', params: { name: 'list_community_messages', arguments: {} } })
		);
		expect(response.status).toBe(200);
		await response.text();
		expect(events).toEqual([]);
	});
});

const recordedBody = (bytes: number, events: string[]) => {
	const chunk = 65_536;
	let sent = 0;
	return new ReadableStream<Uint8Array>(
		{
			pull(controller) {
				if (sent >= bytes) {
					events.push('read to its end');
					controller.close();
					return;
				}
				const size = Math.min(chunk, bytes - sent);
				sent += size;
				controller.enqueue(new Uint8Array(size).fill(0x20));
			}
		},
		{ highWaterMark: 0 }
	);
};

describe('refusal of an oversized body', () => {
	const oversized = MAX_BODY_BYTES + 1;

	it.each([
		[413, { authorization: 'Bearer token' }],
		[401, {}],
		[403, { authorization: 'Bearer token', origin: 'https://foreign.example.test' }]
	])('reads the whole body before it answers %i', async (status, headers) => {
		const events: string[] = [];
		const { authorization: _, ...unauthenticated } = baseHeaders;
		const init: RequestInit & { readonly duplex: 'half' } = {
			method: 'POST',
			headers: {
				...unauthenticated,
				...routingHeaders('tools/list', {}),
				'content-length': String(oversized),
				...headers
			},
			body: recordedBody(oversized, events),
			duplex: 'half'
		};
		const response = await endpoint({ scopes: READ }).handle(new Request(MCP_URL, init));
		events.push('settled');
		expect(response.status).toBe(status);
		expect(events).toEqual(['read to its end', 'settled']);
	});
});
