import * as ByteSize from 'effect/ByteSize';
import * as Clock from 'effect/Clock';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Record from 'effect/Record';
import * as Scheduler from 'effect/Scheduler';
import * as Schema from 'effect/Schema';
import type * as Tool from 'effect/ai/Tool';
import * as McpProtocol from 'effect/ai/McpProtocol';
import * as McpServer from 'effect/ai/McpServer';
import * as HttpEffect from 'effect/http/HttpEffect';
import * as HttpIncomingMessage from 'effect/http/HttpIncomingMessage';
import * as HttpRouter from 'effect/http/HttpRouter';
import type * as HttpServerError from 'effect/http/HttpServerError';
import * as HttpServerRequest from 'effect/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/http/HttpServerResponse';
import { syncScheduler } from '../../effect/scheduler';
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
import { AppToolkit, AppToolkitLive, MCP_SERVER } from './toolkit';

export const MCP_PATH = '/mcp';

export const MAX_BODY_BYTES = 1_048_576;

const DRAIN_LIMIT_BYTES = 16 * MAX_BODY_BYTES;

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

type Functions = typeof refs;

type AppTools = (typeof AppToolkit)['tools'];

const appTools: Readonly<Record<string, Tool.Any>> = AppToolkit.tools;

export type McpRoutesOptions = {
	readonly handlers?: Layer.Layer<Tool.HandlersFor<AppTools>>;
	readonly access?: Layer.Layer<McpAccess, never, McpPrincipal>;
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

const answerToOrigin = (origin: string) =>
	HttpEffect.appendPreResponseHandler((_request, response) =>
		Effect.succeed(
			HttpServerResponse.setHeaders(response, {
				'Access-Control-Allow-Origin': origin,
				'Access-Control-Expose-Headers': 'WWW-Authenticate',
				Vary: 'Origin'
			})
		)
	);

const challenge = (status: 401 | 403, parameters: readonly string[]) =>
	HttpServerResponse.empty({
		status,
		headers: {
			'WWW-Authenticate': `Bearer ${[
				...parameters,
				`resource_metadata="${protectedResourceMetadataUrl()}"`
			].join(', ')}`
		}
	});

const preflight = (verdict: OriginVerdict) =>
	HttpServerResponse.empty({
		status: 204,
		headers:
			verdict.kind === 'allowed'
				? {
						'Access-Control-Allow-Methods': 'POST, OPTIONS',
						'Access-Control-Allow-Headers': ALLOWED_REQUEST_HEADERS,
						'Access-Control-Max-Age': '600'
					}
				: {}
	});

const discard = async (body: ReadableStream<Uint8Array> | null) => {
	if (body === null || body.locked) return;
	const reader = body.getReader();
	let total = 0;
	for (let next = await reader.read(); !next.done; next = await reader.read()) {
		total += next.value.byteLength;
		if (total > DRAIN_LIMIT_BYTES) {
			reader.cancel().catch(() => undefined);
			return;
		}
	}
};

const refuse = (
	request: HttpServerRequest.HttpServerRequest,
	response: HttpServerResponse.HttpServerResponse
) =>
	HttpServerRequest.toWeb(request).pipe(
		Effect.flatMap((source) => Effect.tryPromise(() => discard(source.body))),
		Effect.ignore,
		Effect.as(response)
	);

const bearerToken = (request: HttpServerRequest.HttpServerRequest) =>
	Option.fromNullishOr(/^Bearer\s+(\S+)$/iu.exec(request.headers['authorization'] ?? '')?.[1]);

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

type Body =
	| { readonly _tag: 'Read'; readonly text: string }
	| { readonly _tag: 'TooLarge' }
	| { readonly _tag: 'Unreadable' };

const isTooLarge = (error: HttpServerError.HttpServerError) =>
	error.reason._tag === 'RequestParseError' && error.reason.reason === 'BodyTooLarge';

const readBody = (request: HttpServerRequest.HttpServerRequest) =>
	request.text.pipe(
		Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(MAX_BODY_BYTES)),
		Effect.map((text): Body => ({ _tag: 'Read', text })),
		Effect.catch((error) =>
			Effect.succeed<Body>(isTooLarge(error) ? { _tag: 'TooLarge' } : { _tag: 'Unreadable' })
		)
	);

const ToolCall = Schema.fromJsonString(
	Schema.Struct({
		method: Schema.Literal('tools/call'),
		params: Schema.Struct({ name: Schema.String })
	})
);

const decodeToolCall = Schema.decodeUnknownOption(ToolCall);

const calledTool = (request: HttpServerRequest.HttpServerRequest, body: Body) =>
	body._tag === 'Read' && request.headers['mcp-method'] === 'tools/call'
		? decodeToolCall(body.text).pipe(
				Option.map(({ params }) => params.name),
				Option.filter((name) => request.headers['mcp-name'] === name),
				Option.flatMap((name) => Record.get(appTools, name))
			)
		: Option.none();

const guard = (functions: Functions, access: Layer.Layer<McpAccess, never, McpPrincipal>) =>
	HttpRouter.middleware<{ provides: McpPrincipal | McpAccess }>()(
		(httpEffect) =>
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest;
				const verdict = originVerdict(request);
				if (verdict.kind === 'refused') {
					return yield* refuse(request, HttpServerResponse.empty({ status: 403 }));
				}
				if (verdict.kind === 'allowed') yield* answerToOrigin(verdict.origin);
				if (request.method === 'OPTIONS') return preflight(verdict);

				const token = bearerToken(request);
				if (Option.isNone(token)) return yield* refuse(request, challenge(401, []));
				const accepted = yield* authenticate(functions, token.value);
				if (Option.isNone(accepted)) {
					return yield* refuse(request, challenge(401, ['error="invalid_token"']));
				}
				const { verified, now } = accepted.value;
				yield* recordUse(functions, verified, verified.useRecordedAt, now);

				const body = request.method === 'POST' ? yield* readBody(request) : undefined;
				if (body?._tag === 'TooLarge') {
					return yield* refuse(request, HttpServerResponse.empty({ status: 413 }));
				}

				const principal = McpPrincipal.of({
					userId: verified.userId,
					clientId: verified.clientId,
					scopes: verified.scopes
				});
				const rule = yield* Effect.service(McpAccess).pipe(
					Effect.provide(access, { local: true }),
					Effect.provideService(McpPrincipal, principal)
				);

				const tool = body === undefined ? Option.none() : calledTool(request, body);
				const decision = Option.map(tool, rule.decide);
				if (Option.isSome(decision) && decision.value._tag === 'InsufficientScope') {
					return yield* refuse(
						request,
						challenge(403, [
							'error="insufficient_scope"',
							`scope="${decision.value.required.join(' ')}"`
						])
					);
				}

				return yield* httpEffect.pipe(
					Effect.provideService(McpPrincipal, principal),
					Effect.provideService(McpAccess, rule)
				);
			}),
		{ global: true }
	);

const accessVisibility = McpServer.visibility(({ target }) =>
	McpAccess.useSync((rule) =>
		Option.match(Record.get(appTools, target), {
			onNone: () => false,
			onSome: (tool) => rule.decide(tool)._tag === 'Allowed'
		})
	)
);

export const mcpRoutes = (functions: Functions, options: McpRoutesOptions = {}) =>
	Layer.unwrap(
		Effect.sync(() =>
			McpServer.layerHttpRequestScoped({
				name: MCP_SERVER.name,
				version: MCP_SERVER.version,
				path: MCP_PATH,
				protocols: [McpProtocol.v2026_07_28],
				allowedOrigins: [...allowedBrowserOrigins()],
				registrations: McpServer.toolkit(AppToolkit).pipe(
					Layer.provide(accessVisibility.layer),
					Layer.provide(options.handlers ?? AppToolkitLive(functions))
				)
			})
		)
	).pipe(
		Layer.orDie,
		Layer.provide(Layer.succeed(Scheduler.Scheduler, syncScheduler())),
		Layer.provide(guard(functions, options.access ?? scopeAccess))
	);

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
