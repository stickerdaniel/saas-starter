import { createMcpHandler } from '@modelcontextprotocol/server';
import * as Clock from 'effect/Clock';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Record from 'effect/Record';
import * as Schema from 'effect/Schema';
import * as Scope from 'effect/Scope';
import type * as Tool from 'effect/ai/Tool';
import type * as Toolkit from 'effect/ai/Toolkit';
import * as HttpRouter from 'effect/http/HttpRouter';
import * as HttpServerRequest from 'effect/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/http/HttpServerResponse';
import type refs from '../_generated/refs';
import { MutationRunner, QueryRunner } from '../_generated/services';
import {
	allowedBrowserOrigins,
	mcpAudiences,
	PROTECTED_RESOURCE_METADATA_PATHS,
	protectedResourceMetadata,
	protectedResourceMetadataUrl,
	USE_RECORD_INTERVAL
} from '../oauth/resource';
import { McpAccess, McpPrincipal, scopeAccess } from './access';
import { toolkitServerFactory } from './bridge';
import { MCP_SERVER } from './toolkit';

export const MCP_PATH = '/mcp';

export const MAX_BODY_BYTES = 1_048_576;

const ALLOWED_REQUEST_HEADERS = [
	'Authorization',
	'Content-Type',
	'MCP-Protocol-Version',
	'Mcp-Method',
	'Mcp-Name'
].join(', ');

const PUBLIC_DOCUMENT_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Cache-Control': 'public, max-age=15, stale-while-revalidate=15, stale-if-error=86400'
};

type OriginVerdict =
	| { readonly kind: 'absent' }
	| { readonly kind: 'allowed'; readonly origin: string }
	| { readonly kind: 'refused' };

const originVerdict = (request: HttpServerRequest.HttpServerRequest): OriginVerdict => {
	const origin = request.headers['origin'];
	if (origin === undefined) return { kind: 'absent' };
	return allowedBrowserOrigins().has(origin) ? { kind: 'allowed', origin } : { kind: 'refused' };
};

const corsHeaders = (verdict: OriginVerdict): Record<string, string> =>
	verdict.kind === 'allowed'
		? {
				'Access-Control-Allow-Origin': verdict.origin,
				'Access-Control-Expose-Headers': 'WWW-Authenticate',
				Vary: 'Origin'
			}
		: {};

const refusedOrigin = HttpServerResponse.empty({ status: 403 });

const challenge = (verdict: OriginVerdict, status: 401 | 403, parameters: readonly string[]) =>
	HttpServerResponse.empty({
		status,
		headers: {
			...corsHeaders(verdict),
			'WWW-Authenticate': `Bearer ${[
				...parameters,
				`resource_metadata="${protectedResourceMetadataUrl()}"`
			].join(', ')}`
		}
	});

const RpcHead = Schema.Struct({
	method: Schema.String,
	params: Schema.optional(Schema.Struct({ name: Schema.optional(Schema.Unknown) }))
});

const decodeHead = Schema.decodeUnknownOption(Schema.fromJsonString(RpcHead));

type BoundedBody =
	| { readonly tooLarge: true }
	| { readonly tooLarge: false; readonly bytes: Uint8Array<ArrayBuffer> };

const readBounded = (source: Request) =>
	Effect.promise(async (): Promise<BoundedBody> => {
		if (source.body === null) return { tooLarge: false, bytes: new Uint8Array(0) };
		const reader = source.body.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			total += next.value.byteLength;
			if (total > MAX_BODY_BYTES) {
				await reader.cancel();
				return { tooLarge: true };
			}
			chunks.push(next.value);
		}
		const bytes = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return { tooLarge: false, bytes };
	});

const bearerToken = (request: HttpServerRequest.HttpServerRequest) =>
	Option.fromNullishOr(/^Bearer\s+(\S+)$/iu.exec(request.headers['authorization'] ?? '')?.[1]);

type Functions = typeof refs;

const authenticate = (functions: Functions, token: string) =>
	Effect.gen(function* () {
		const verified = yield* (yield* QueryRunner)
			.runQuery(functions.internal.oauth.access.verify, { token, audiences: mcpAudiences() })
			.pipe(Effect.catchTag('SchemaError', Effect.die));
		const now = yield* Clock.currentTimeMillis;
		return verified !== null && verified.expiresAt > now
			? Option.some({ verified, now })
			: Option.none();
	});

const recordUse = (
	functions: Functions,
	use: { readonly userId: string; readonly clientId: string; readonly grant: string },
	recordedAt: number | null,
	now: number
) =>
	recordedAt !== null && now - recordedAt < Duration.toMillis(USE_RECORD_INTERVAL)
		? Effect.void
		: MutationRunner.use((mutations) =>
				mutations.runMutation(functions.internal.oauth.connections.recordUse, { ...use, at: now })
			).pipe(
				Effect.asVoid,
				Effect.catchCause((cause) => Effect.logError('mcp use record failed', cause))
			);

const isEventStream = (response: Response) =>
	response.headers.get('content-type')?.includes('text/event-stream') === true;

const passOn = (response: Response, verdict: OriginVerdict) =>
	Effect.gen(function* () {
		if (isEventStream(response)) {
			return {
				handedOn: true,
				response: HttpServerResponse.setHeaders(
					HttpServerResponse.fromWeb(response),
					corsHeaders(verdict)
				)
			};
		}
		const headers = new Headers(response.headers);
		headers.delete('content-length');
		const options = {
			status: response.status,
			headers: { ...Object.fromEntries(headers), ...corsHeaders(verdict) }
		};
		if (response.body === null) {
			return { handedOn: false, response: HttpServerResponse.empty(options) };
		}
		const bytes = new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()));
		return { handedOn: false, response: HttpServerResponse.uint8Array(bytes, options) };
	});

type ToolServices = McpPrincipal | QueryRunner | MutationRunner;

const serve =
	<Tools extends Record<string, Tool.Any>>(
		functions: Functions,
		toolkit: Toolkit.Toolkit<Tools>,
		handlers: Layer.Layer<Tool.HandlersFor<Tools>, never, ToolServices>
	) =>
	(request: HttpServerRequest.HttpServerRequest) =>
		Effect.gen(function* () {
			const verdict = originVerdict(request);
			if (verdict.kind === 'refused') return refusedOrigin;

			const token = bearerToken(request);
			if (Option.isNone(token)) return challenge(verdict, 401, []);
			const accepted = yield* authenticate(functions, token.value);
			if (Option.isNone(accepted)) return challenge(verdict, 401, ['error="invalid_token"']);
			const { verified, now } = accepted.value;
			yield* recordUse(functions, verified, verified.useRecordedAt, now);

			const source = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
			const body = yield* readBounded(source);
			if (body.tooLarge) {
				return HttpServerResponse.empty({ status: 413, headers: corsHeaders(verdict) });
			}

			const principal = Layer.succeed(McpPrincipal, {
				userId: verified.userId,
				clientId: verified.clientId,
				scopes: verified.scopes
			});
			const access = scopeAccess.pipe(Layer.provide(principal));

			const head = decodeHead(new TextDecoder().decode(body.bytes));
			if (Option.isSome(head) && head.value.method === 'tools/call') {
				const name = head.value.params?.name;
				const tool = typeof name === 'string' ? Record.get(toolkit.tools, name) : Option.none();
				if (Option.isSome(tool)) {
					const decision = yield* McpAccess.useSync((rule) => rule.decide(tool.value)).pipe(
						Effect.provide(access)
					);
					if (decision._tag === 'InsufficientScope') {
						return challenge(verdict, 403, [
							'error="insufficient_scope"',
							`scope="${decision.required.join(' ')}"`
						]);
					}
				}
			}

			const tools = yield* Scope.fork(yield* Effect.scope);
			const served = Effect.gen(function* () {
				const factory = yield* toolkitServerFactory(toolkit, MCP_SERVER).pipe(
					Effect.provide(Layer.mergeAll(handlers, access).pipe(Layer.provideMerge(principal))),
					Scope.provide(tools)
				);
				const handler = createMcpHandler(factory, {
					legacy: 'stateless',
					responseMode: 'json',
					maxRequestBodySize: MAX_BODY_BYTES
				});
				const rebuilt = new Request(source.url, {
					method: source.method,
					headers: source.headers,
					body: source.method === 'GET' || source.method === 'HEAD' ? undefined : body.bytes,
					signal: source.signal
				});
				const response = yield* Effect.promise(() => handler.fetch(rebuilt));
				return yield* passOn(response, verdict);
			});
			const { response } = yield* served.pipe(
				Effect.onExit((exit) =>
					Exit.isSuccess(exit) && exit.value.handedOn ? Effect.void : Scope.close(tools, Exit.void)
				)
			);
			return response;
		});

const preflight = (request: HttpServerRequest.HttpServerRequest) =>
	Effect.sync(() => {
		const verdict = originVerdict(request);
		if (verdict.kind === 'refused') return refusedOrigin;
		return HttpServerResponse.empty({
			status: 204,
			headers:
				verdict.kind === 'allowed'
					? {
							...corsHeaders(verdict),
							'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
							'Access-Control-Allow-Headers': ALLOWED_REQUEST_HEADERS,
							'Access-Control-Max-Age': '600'
						}
					: {}
		});
	});

export const mcpRoutes = <Tools extends Record<string, Tool.Any>>(
	functions: Functions,
	toolkit: Toolkit.Toolkit<Tools>,
	handlers: Layer.Layer<Tool.HandlersFor<Tools>, never, ToolServices>
) => {
	const handle = serve(functions, toolkit, handlers);
	return Layer.mergeAll(
		HttpRouter.add('POST', MCP_PATH, handle),
		HttpRouter.add('GET', MCP_PATH, handle),
		HttpRouter.add('DELETE', MCP_PATH, handle),
		HttpRouter.add('OPTIONS', MCP_PATH, preflight)
	);
};

const metadataDocument = Effect.sync(() =>
	HttpServerResponse.jsonUnsafe(protectedResourceMetadata(), { headers: PUBLIC_DOCUMENT_HEADERS })
);

const metadataPreflight = HttpServerResponse.empty({
	status: 204,
	headers: PUBLIC_DOCUMENT_HEADERS
});

const [ROOT_METADATA_PATH, MCP_METADATA_PATH] = PROTECTED_RESOURCE_METADATA_PATHS;

export const ProtectedResourceMetadataRoutes = Layer.mergeAll(
	HttpRouter.add('GET', ROOT_METADATA_PATH, metadataDocument),
	HttpRouter.add('GET', MCP_METADATA_PATH, metadataDocument),
	HttpRouter.add('OPTIONS', ROOT_METADATA_PATH, metadataPreflight),
	HttpRouter.add('OPTIONS', MCP_METADATA_PATH, metadataPreflight)
);
