// @vitest-environment node
import { MutationRunner, QueryRunner } from '@confect/server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import * as Tool from 'effect/ai/Tool';
import * as Toolkit from 'effect/ai/Toolkit';
import * as HttpRouter from 'effect/http/HttpRouter';
import * as HttpServer from 'effect/http/HttpServer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimited } from '../../effect/errors';
import refs from '../_generated/refs';
import { mcpRoutes } from './endpoint';
import { AppToolkit, AppToolkitLive } from './toolkit';

const SITE = 'https://app.example.test';
const CONVEX_SITE = 'https://deployment.example.test';
const MCP_URL = `${CONVEX_SITE}/mcp`;
const MODERN = '2026-07-28';
const LEGACY = '2025-11-25';
const READ = ['mcp:read'];
const READ_WRITE = ['mcp:read', 'mcp:write'];

const USER = {
	_id: 'user-1',
	_creationTime: 1,
	name: 'Ada',
	email: 'ada@example.test',
	emailVerified: true,
	createdAt: 1,
	updatedAt: 1
};

type Stubs = {
	readonly scopes: readonly string[];
	readonly userId?: string;
	readonly sendAs?: (args: unknown) => Promise<unknown>;
};

const services = ({ scopes, userId = USER._id, sendAs }: Stubs) => {
	const runQuery = vi.fn();
	runQuery.mockImplementation((reference: FunctionReference<'query', 'internal'>) => {
		switch (getFunctionName(reference)) {
			case 'oauth/access:verify':
				return Promise.resolve({
					userId,
					clientId: 'client-1',
					scopes,
					expiresAt: Date.now() + 3_600_000,
					grant: '0',
					audience: MCP_URL,
					useRecordedAt: Date.now()
				});
			case 'users:viewerAs':
				return Promise.resolve(USER);
			case 'messages:listAs':
				return Promise.resolve([]);
		}
		return Promise.reject(new Error(`unexpected query ${getFunctionName(reference)}`));
	});
	const runMutation = vi.fn();
	runMutation.mockImplementation(
		(reference: FunctionReference<'mutation', 'internal'>, args: unknown) =>
			getFunctionName(reference) === 'messages:sendAs' && sendAs
				? sendAs(args)
				: Promise.reject(new Error(`unexpected mutation ${getFunctionName(reference)}`))
	);
	return Layer.mergeAll(QueryRunner.layer(runQuery), MutationRunner.layer(runMutation)).pipe(
		Layer.build,
		Effect.scoped,
		Effect.runSync
	);
};

const webHandler = <Tools extends Record<string, Tool.Any>>(
	toolkit: Toolkit.Toolkit<Tools>,
	handlers: Parameters<typeof mcpRoutes<Tools>>[2]
) =>
	HttpRouter.toWebHandler(
		mcpRoutes(refs, toolkit, handlers).pipe(Layer.provide(HttpServer.layerServices)),
		{ disableLogger: true }
	);

const appHandler = (stubs: Stubs) => {
	const { handler } = webHandler(AppToolkit, AppToolkitLive(refs));
	const context = services(stubs);
	return (request: Request) => handler(request, context);
};

const rpc = (era: 'modern' | 'legacy', method: string, params: Record<string, unknown> = {}) => {
	const headers: Record<string, string> = {
		authorization: 'Bearer token',
		'content-type': 'application/json',
		accept: 'application/json, text/event-stream',
		'mcp-protocol-version': era === 'modern' ? MODERN : LEGACY
	};
	if (era === 'modern') {
		headers['mcp-method'] = method;
		if (typeof params.name === 'string') headers['mcp-name'] = params.name;
	}
	const body = {
		jsonrpc: '2.0',
		id: 1,
		method,
		params:
			era === 'modern'
				? {
						...params,
						_meta: {
							'io.modelcontextprotocol/protocolVersion': MODERN,
							'io.modelcontextprotocol/clientCapabilities': {}
						}
					}
				: params
	};
	return { headers, body: JSON.stringify(body) };
};

const post = (era: 'modern' | 'legacy', method: string, params?: Record<string, unknown>) => {
	const { headers, body } = rpc(era, method, params);
	return (
		init: { readonly headers?: Record<string, string>; readonly signal?: AbortSignal } = {}
	) =>
		new Request(MCP_URL, {
			method: 'POST',
			headers: { ...headers, ...init.headers },
			body,
			signal: init.signal
		});
};

const CallResult = Schema.Struct({
	result: Schema.Struct({
		isError: Schema.optional(Schema.Boolean),
		content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String }))
	})
});

const decodeCall = Schema.decodeUnknownSync(Schema.fromJsonString(CallResult));

const ERAS = [
	['legacy', { mode: 'legacy' }],
	['modern', { mode: { pin: MODERN } }]
] as const;

const connect = async (
	handle: (request: Request) => Promise<Response>,
	negotiation: (typeof ERAS)[number][1]
) => {
	const client = new Client(
		{ name: 'endpoint-test', version: '0.0.0' },
		{ versionNegotiation: negotiation }
	);
	await client.connect(
		new StreamableHTTPClientTransport(new URL(MCP_URL), {
			requestInit: { headers: { authorization: 'Bearer token' } },
			fetch: (input, init) => handle(new Request(input, init))
		})
	);
	return client;
};

beforeEach(() => {
	vi.stubEnv('SITE_URL', SITE);
	vi.stubEnv('CONVEX_SITE_URL', CONVEX_SITE);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('tool list', () => {
	it.each(ERAS)('follows the scopes of the principal in the %s era', async (era, negotiation) => {
		const read = await connect(appHandler({ scopes: READ }), negotiation);
		const both = await connect(appHandler({ scopes: READ_WRITE }), negotiation);
		expect(read.getProtocolEra()).toBe(era);
		expect((await read.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
			'get_account',
			'list_community_messages'
		]);
		expect((await both.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
			'get_account',
			'list_community_messages',
			'post_community_message'
		]);
	});

	it('lists each tool with its title at both places and the four hints', async () => {
		const client = await connect(appHandler({ scopes: READ_WRITE }), ERAS[1][1]);
		const { tools } = await client.listTools();
		expect(tools).toHaveLength(3);
		for (const tool of tools) {
			expect(tool.title).toEqual(expect.any(String));
			expect(tool.annotations?.title).toBe(tool.title);
			for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
				expect(tool.annotations).toHaveProperty(hint, expect.any(Boolean));
			}
		}
	});
});

describe('acting user', () => {
	it('posts each message as the principal of its own request', async () => {
		const received: unknown[] = [];
		const sendAs = (args: unknown) => {
			received.push(args);
			return Promise.resolve({ messageId: 'message-1' });
		};
		for (const userId of ['user-1', 'user-2']) {
			const response = await appHandler({ scopes: READ_WRITE, userId, sendAs })(
				post('modern', 'tools/call', {
					name: 'post_community_message',
					arguments: { body: `from ${userId}` }
				})()
			);
			expect(decodeCall(await response.text()).result.isError).toBeUndefined();
		}
		expect(received).toEqual([
			{ userId: 'user-1', body: 'from user-1' },
			{ userId: 'user-2', body: 'from user-2' }
		]);
	});
});

describe('tool errors', () => {
	const send = (sendAs: () => Promise<unknown>) =>
		appHandler({ scopes: READ_WRITE, sendAs })(
			post('modern', 'tools/call', { name: 'post_community_message', arguments: { body: 'hi' } })()
		);

	it('returns a declared failure of the twin as a tool error with its text', async () => {
		const response = await send(() =>
			Promise.reject(new ConvexError({ code: 'RATE_LIMITED', retryAfter: 30_000 }))
		);
		expect(decodeCall(await response.text()).result).toEqual({
			isError: true,
			content: [{ type: 'text', text: 'Rate limited. Retry in 30 s.' }]
		});
	});

	it.each([
		[
			'a defect that carries a declared tag',
			() => Promise.reject(new RateLimited({ retryAfter: 987_654_000 }))
		],
		['a plain defect', () => Promise.reject(new Error('defect detail 987654'))]
	])('redacts %s as an internal error', async (_label, sendAs) => {
		const body = await (await send(sendAs)).text();
		expect(decodeCall(body).result).toEqual({
			isError: true,
			content: [{ type: 'text', text: 'Internal error' }]
		});
		expect(body).not.toContain('987654');
		expect(body).not.toContain('defect detail');
	});
});

describe('origin policy', () => {
	const list = post('modern', 'tools/list');

	it('serves a request without Origin', async () => {
		expect((await appHandler({ scopes: READ })(list())).status).toBe(200);
	});

	it('serves the app origin with CORS headers', async () => {
		const response = await appHandler({ scopes: READ })(list({ headers: { origin: SITE } }));
		expect(response.status).toBe(200);
		expect(response.headers.get('access-control-allow-origin')).toBe(SITE);
		expect(response.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate');
		expect(response.headers.get('access-control-allow-credentials')).toBeNull();
	});

	it.each(['https://foreign.example.test', 'null', 'not a url'])(
		'refuses the Origin %s with a valid bearer',
		async (origin) => {
			const response = await appHandler({ scopes: READ })(list({ headers: { origin } }));
			expect(response.status).toBe(403);
		}
	);

	it('answers a preflight from the app origin with the methods and request headers', async () => {
		const response = await appHandler({ scopes: READ })(
			new Request(MCP_URL, {
				method: 'OPTIONS',
				headers: { origin: SITE, 'access-control-request-method': 'POST' }
			})
		);
		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-origin')).toBe(SITE);
		const methods = response.headers.get('access-control-allow-methods')?.split(', ');
		expect(methods).toEqual(expect.arrayContaining(['GET', 'POST', 'DELETE', 'OPTIONS']));
		expect(response.headers.get('access-control-allow-headers')?.split(', ')).toEqual([
			'Authorization',
			'Content-Type',
			'MCP-Protocol-Version',
			'Mcp-Method',
			'Mcp-Name'
		]);
	});
});

describe('response fidelity', () => {
	it('returns the bodyless 202 of a notification without a body type and length', async () => {
		const response = await appHandler({ scopes: READ })(
			new Request(MCP_URL, {
				method: 'POST',
				headers: { ...rpc('legacy', 'unused').headers },
				body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
			})
		);
		expect(response.status).toBe(202);
		expect(response.headers.get('content-type')).toBeNull();
		expect(response.headers.get('content-length')).toBeNull();
		expect(await response.text()).toBe('');
	});

	it('keeps the status and body type of a modern JSON result', async () => {
		const response = await appHandler({ scopes: READ })(post('modern', 'tools/list')());
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/json');
	});
});

const marker = () => {
	let fire = () => {};
	const fired = new Promise<void>((resolve) => {
		fire = resolve;
	});
	return { fire, fired };
};

const slowToolkit = () => {
	const started = marker();
	const interrupted = marker();
	const events: string[] = [];
	const Slow = Tool.make('slow', { success: Schema.Struct({ done: Schema.Boolean }) }).annotate(
		Tool.Readonly,
		true
	);
	const Quick = Tool.make('quick', { success: Schema.Struct({ done: Schema.Boolean }) }).annotate(
		Tool.Readonly,
		true
	);
	const tools = Toolkit.make(Slow, Quick);
	const onInterrupt = Effect.onInterrupt(() =>
		Effect.promise(() => Promise.resolve()).pipe(
			Effect.andThen(
				Effect.sync(() => {
					events.push('interrupted');
					interrupted.fire();
				})
			)
		)
	);
	const live = tools.toLayer({
		slow: () => Effect.sync(started.fire).pipe(Effect.andThen(Effect.never), onInterrupt),
		quick: () => Effect.succeed({ done: true }).pipe(onInterrupt)
	});
	const { handler } = webHandler(tools, live);
	const context = services({ scopes: READ });
	return {
		handle: (request: Request) => handler(request, context),
		started,
		interrupted,
		events
	};
};

describe('tool scope', () => {
	it('interrupts the handler of an aborted request before the response settles', async () => {
		const { handle, started, events } = slowToolkit();
		const controller = new AbortController();
		const settled = handle(
			post('modern', 'tools/call', { name: 'slow', arguments: {} })({ signal: controller.signal })
		).then(
			() => events.push('settled'),
			() => events.push('settled')
		);
		await started.fired;
		controller.abort();
		await settled;
		expect(events).toEqual(['interrupted', 'settled']);
	});

	it('records no interruption for a completed call', async () => {
		const { handle, events } = slowToolkit();
		const response = await handle(post('modern', 'tools/call', { name: 'quick', arguments: {} })());
		expect(response.status).toBe(200);
		await response.text();
		expect(events).toEqual([]);
	});

	it('interrupts the handler when a legacy SSE body is cancelled', async () => {
		const { handle, started, interrupted } = slowToolkit();
		const response = await handle(post('legacy', 'tools/call', { name: 'slow', arguments: {} })());
		expect(response.headers.get('content-type')).toContain('text/event-stream');
		await started.fired;
		await response.body?.cancel();
		await interrupted.fired;
	});
});
