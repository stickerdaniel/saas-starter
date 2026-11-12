// What a Sentry event may carry, for both runtimes that report: the SvelteKit
// server and the browser. No sink gets failure content outside dev, so an
// event keeps where a failure happened and which call it belongs to, and drops
// what it was about. Runtime-neutral, like redact.ts: the types below are the
// structural part of the SDK's event that this reads, not an SDK import.

import { CORRELATION_KEYS } from './describe-error';
import { redactText } from './redact';

type ProjectableFrame = {
	filename?: string;
	abs_path?: string;
	module?: string;
	vars?: unknown;
	pre_context?: unknown;
	context_line?: unknown;
	post_context?: unknown;
};

type ProjectableException = {
	type?: string;
	value?: string;
	stacktrace?: { frames?: ProjectableFrame[] };
};

type ProjectableBreadcrumb = { category?: string; level?: string; timestamp?: number };

type Attributes = { [key: string]: unknown };

type ProjectableSpan = {
	span_id?: string;
	trace_id?: string;
	parent_span_id?: string;
	op?: string;
	status?: string;
	origin?: string;
	start_timestamp?: number;
	timestamp?: number;
	description?: string;
	data?: Attributes;
};

type ProjectableContexts = { [name: string]: Attributes | undefined };

type ProjectableEvent = {
	type?: string;
	transaction_info?: { source?: string };
	exception?: { values?: ProjectableException[] };
	message?: string;
	breadcrumbs?: ProjectableBreadcrumb[];
	tags?: Attributes;
	contexts?: ProjectableContexts;
	request?: { method?: string; url?: string; headers?: { [key: string]: string } };
	transaction?: string;
	spans?: ProjectableSpan[];
};

type ProjectionOptions = {
	/**
	 * What a request URL or span description may say. By default a request URL
	 * keeps its origin and the event's route, a span description its method
	 * and origin.
	 */
	url?: (raw: string) => string | undefined;
};

const REDACTED = '[redacted]';
// What the engine filled in from the program, in a kept engine message.
const ELIDED = '…';

// Every exception message is replaced, keeping type and stack, unless it is one
// of the engine messages below, and those keep the engine's wording only: each
// part the engine filled in becomes `…`, because a property name can be a
// grant and a callee can be any identifier. The type is no guide on its own:
// JSC's JSON.parse SyntaxError quotes the parsed text, and Node's URL TypeError
// quotes the URL. The wording is JavaScriptCore's (Bun 1.4.3) and V8's (Node,
// Chromium); a message only shaped like one, with spaces where the engine
// writes a source path, stays replaced. The last three are the fixed TypeError
// a rejected fetch() carries on a network failure in Chromium, Safari and
// Firefox; they name no request, so they stay whole and nothing may follow them.
const SOURCE_PATH = String.raw`[\w.$\[\]'"]+`;
const ENGINE_MESSAGES: ReadonlyArray<readonly [RegExp, (match: RegExpExecArray) => string]> = [
	[
		new RegExp(String.raw`^(undefined|null) is not an object \(evaluating '${SOURCE_PATH}'\)$`),
		([, value]) => `${value} is not an object (evaluating '${ELIDED}')`
	],
	[
		new RegExp(
			String.raw`^Cannot (read|set) properties of (undefined|null) \((reading|setting) '${SOURCE_PATH}'\)$`
		),
		([, verb, value, access]) => `Cannot ${verb} properties of ${value} (${access} '${ELIDED}')`
	],
	[
		new RegExp(
			String.raw`^${SOURCE_PATH} is not a function(?:\. \(In '${SOURCE_PATH}\(\)', '${SOURCE_PATH}' is (undefined|null)\))?$`
		),
		([, value]) =>
			value
				? `${ELIDED} is not a function. (In '${ELIDED}()', '${ELIDED}' is ${value})`
				: `${ELIDED} is not a function`
	],
	[/^Can't find variable: [\w$]+$/, () => `Can't find variable: ${ELIDED}`],
	[/^[\w$]+ is not defined$/, () => `${ELIDED} is not defined`],
	[
		/^Cannot access '[\w$]+' before initialization\.?$/,
		() => `Cannot access '${ELIDED}' before initialization`
	],
	[/^Maximum call stack size exceeded\.?$/, () => 'Maximum call stack size exceeded'],
	[/^Failed to fetch$/, () => 'Failed to fetch'],
	[/^Load failed$/, () => 'Load failed'],
	[
		/^NetworkError when attempting to fetch resource\.$/,
		() => 'NetworkError when attempting to fetch resource.'
	]
];
const ENGINE_ERROR_TYPES = new Set(['TypeError', 'RangeError', 'ReferenceError']);

function engineMessage(type: string | undefined, message: string): string {
	if (!type || !ENGINE_ERROR_TYPES.has(type)) return REDACTED;
	for (const [pattern, wording] of ENGINE_MESSAGES) {
		const match = pattern.exec(message);
		if (match) return wording(match);
	}
	return REDACTED;
}

// A frame's file can be the page it ran on, and a page URL carries its query
// (`/reset-password?token=`). The path stays for source maps and grouping.
function frameLocation(location: string): string {
	const end = location.search(/[?#]/);
	return redactText(end === -1 ? location : location.slice(0, end));
}

// `[METHOD ][origin][path][?query][#fragment]`, the shape of a request URL, a
// transaction name and an HTTP span description. User info is not captured.
const LOCATION =
	/^(?:([A-Z]{3,7}) )?(?:([a-z][a-z+.-]{0,15}:\/\/)(?:[^/?#\s@]*@)?([^/?#\s@]+))?(\/[^?#\s]*)?(?:[?#]\S*)?$/;

type Location = { method?: string; origin?: string; path?: string };

function parseLocation(raw: string): Location | undefined {
	const match = LOCATION.exec(raw);
	if (!match) return undefined;
	const [, method, scheme, host, path] = match;
	if (!host && !path) return undefined;
	return { method, origin: host ? `${scheme}${host}` : undefined, path };
}

/**
 * A URL or span description as its method and origin, with `route` as the
 * path when the caller knows the route. A path is never kept as written: a
 * page or document path can name what the user opened. Anything that is not a
 * URL, such as a span named after its arguments, is undefined.
 */
export function reportedLocation(raw: string, route?: string): string | undefined {
	const location = parseLocation(raw);
	if (!location || (!location.origin && route === undefined)) return undefined;
	return `${location.method ? `${location.method} ` : ''}${location.origin ?? ''}${route ?? ''}`;
}

// A path as a URL resolves it, so a raw request target (`/a/../b`) and the
// parsed URL of the same request compare equal.
function resolvedPath(path: string): string {
	return new URL(path, 'http://route.invalid').pathname;
}

// A SvelteKit route id, every segment a static name, a parameter (`[id]`,
// `[[lang=lang]]`, `[...path]`) or a group (`(chat)`). A name with any other
// segment is not one the app declares and goes.
const ROUTE_NAME = '[A-Za-z_][A-Za-z0-9_]*';
const ROUTE_ID = new RegExp(
	String.raw`^(?:/|(?:/(?:[a-z0-9-]+|\[(?:\.\.\.)?${ROUTE_NAME}(?:=${ROUTE_NAME})?\]|\[\[${ROUTE_NAME}(?:=${ROUTE_NAME})?\]\]|\([a-z0-9-]+\)))+)$`
);
// A route id differs from the path it serves only by a parameter or a group.
const ROUTE_ID_PART = /\[[^\]]*\]|\([^)]*\)/;

/**
 * The SvelteKit route id an event names, where the SDK puts it (Sentry
 * 11.10.0). A transaction's name is the route id when `transaction_info.source`
 * is `route`. An error event's name is its scope's: `sentryHandle` sets it to
 * `<METHOD> <route id>` and the browser's route change to the page's route id,
 * but the HTTP server integration (`<METHOD> <request target>`) and the
 * browser's page load and navigation (`location.pathname`, or the destination
 * path while the location still names the page before) set it to a path. So it
 * counts only when it differs from the path the event's request names, by a
 * parameter or a group.
 */
function eventRoute(event: ProjectableEvent): { method?: string; route: string } | undefined {
	const named = event.transaction === undefined ? undefined : parseLocation(event.transaction);
	if (!named?.path || named.origin || !ROUTE_ID.test(named.path)) return undefined;
	const route = { method: named.method, route: redactText(named.path) };
	if (event.transaction_info?.source === 'route') return route;
	if (event.type === 'transaction') return undefined;
	const requested = event.request?.url && parseLocation(event.request.url)?.path;
	return requested &&
		resolvedPath(requested) !== resolvedPath(named.path) &&
		ROUTE_ID_PART.test(named.path)
		? route
		: undefined;
}

const TAGS = new Set(['channel', 'release', 'operation', 'code', 'source']);
const TAG_CHARS = 200;
// Correlation ids are ours or a provider's opaque ids; anything else is not one.
const ID = /^[\w.:/@-]{1,256}$/;
const CORRELATION_IDS = new Set<string>(CORRELATION_KEYS);

// Contexts the SDK fills from the runtime, not from what the code handled.
const RUNTIME_CONTEXTS = new Set(['runtime', 'os', 'device', 'app', 'browser']);
const TRACE_FIELDS = ['trace_id', 'span_id', 'parent_span_id', 'op', 'status', 'origin'];
const CONTEXT_FIELDS = new Map<string, readonly string[]>([
	// The system-error context copies every own property of the error.
	['node_system_error', ['errno', 'code', 'syscall']],
	['response', ['status_code']]
]);

// Top-level fields of an event or a transaction that carry no content, or that
// the functions below project. Everything else is deleted.
const EVENT_FIELDS = new Set([
	'event_id',
	'type',
	'timestamp',
	'start_timestamp',
	'level',
	'platform',
	'logger',
	'server_name',
	'release',
	'dist',
	'environment',
	'sdk',
	'modules',
	'fingerprint',
	'debug_meta',
	'measurements',
	'transaction_info',
	// Stripped by the SDK before sending; it holds live scopes that must not be written.
	'sdkProcessingMetadata',
	'exception',
	'message',
	'breadcrumbs',
	'tags',
	'contexts',
	'request',
	'transaction',
	'spans'
]);
const EXCEPTION_FIELDS = new Set([
	'type',
	'value',
	'mechanism',
	'module',
	'thread_id',
	'stacktrace'
]);

function isPrimitive(value: unknown): value is string | number | boolean {
	return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function keepOnly(target: object, fields: ReadonlySet<string>): void {
	for (const key of Object.keys(target)) {
		if (!fields.has(key)) Reflect.deleteProperty(target, key);
	}
}

function pick(source: Attributes, fields: readonly string[]): Attributes {
	return Object.fromEntries(
		fields.flatMap((field) => (isPrimitive(source[field]) ? [[field, source[field]]] : []))
	);
}

// Span attributes the SDK names itself (`sentry.op`, `sentry.origin`); every
// other attribute can hold a URL, a header or a query.
function sdkAttributes(data: unknown): Attributes {
	if (typeof data !== 'object' || data === null) return {};
	return Object.fromEntries(
		Object.entries(data).filter(([key, value]) => key.startsWith('sentry.') && isPrimitive(value))
	);
}

function projectException(exception: ProjectableException): void {
	keepOnly(exception, EXCEPTION_FIELDS);
	if (exception.value !== undefined) {
		exception.value = engineMessage(exception.type, exception.value);
	}
	for (const frame of exception.stacktrace?.frames ?? []) {
		if (frame.filename !== undefined) frame.filename = frameLocation(frame.filename);
		if (frame.abs_path !== undefined) frame.abs_path = frameLocation(frame.abs_path);
		if (frame.module !== undefined) frame.module = frameLocation(frame.module);
		delete frame.vars;
		delete frame.pre_context;
		delete frame.context_line;
		delete frame.post_context;
	}
}

/** A breadcrumb reduced to category and level, plus the timestamp ingestion requires. */
export function projectBreadcrumb<T extends ProjectableBreadcrumb>(
	breadcrumb: T
): Pick<T, 'category' | 'level' | 'timestamp'> {
	return {
		category: breadcrumb.category,
		level: breadcrumb.level,
		timestamp: breadcrumb.timestamp
	};
}

function projectCorrelation(context: Attributes): Attributes {
	return Object.fromEntries(
		Object.entries(context).filter(
			([key, value]) =>
				(CORRELATION_IDS.has(key) && typeof value === 'string' && ID.test(value)) ||
				// How many reports of the same operation and code were held back.
				(key === 'suppressed' && Number.isSafeInteger(value))
		)
	);
}

function projectContexts(contexts: ProjectableContexts): ProjectableContexts {
	const projected: ProjectableContexts = {};
	for (const [name, context] of Object.entries(contexts)) {
		if (!context) continue;
		const fields = CONTEXT_FIELDS.get(name);
		if (name === 'correlation') projected.correlation = projectCorrelation(context);
		else if (name === 'trace') {
			projected.trace = { ...pick(context, TRACE_FIELDS), data: sdkAttributes(context.data) };
		} else if (fields) projected[name] = pick(context, fields);
		else if (RUNTIME_CONTEXTS.has(name)) {
			projected[name] = Object.fromEntries(
				Object.entries(context).filter(([, value]) => isPrimitive(value))
			);
		}
	}
	return projected;
}

/**
 * Reduces an error or transaction event in place to what reporting may carry:
 * exception types and stack frames without their query, engine wording only;
 * breadcrumbs as category and level; the allowlisted tags; the `correlation`
 * context's ids; the request's method, origin, route id and user
 * agent; span identities, timings, methods and origins; the transaction's route
 * id. Everything else,
 * other contexts, `extra`, `user` and messages included, is dropped or
 * replaced. Returns the same event.
 */
export function projectDiagnosticEvent<T extends ProjectableEvent>(
	event: T,
	options: ProjectionOptions = {}
): T {
	const target: ProjectableEvent = event;
	// Read before the request and transaction below are reduced.
	const named = eventRoute(target);
	const requestUrl = options.url ?? ((raw: string) => reportedLocation(raw, named?.route));
	const spanUrl = options.url ?? ((raw: string) => reportedLocation(raw));
	keepOnly(target, EVENT_FIELDS);
	for (const exception of target.exception?.values ?? []) projectException(exception);
	if (target.message !== undefined) target.message = REDACTED;
	if (target.breadcrumbs) target.breadcrumbs = target.breadcrumbs.map(projectBreadcrumb);
	if (target.tags) {
		target.tags = Object.fromEntries(
			Object.entries(target.tags).flatMap(([key, value]) =>
				TAGS.has(key) && isPrimitive(value) ? [[key, String(value).slice(0, TAG_CHARS)]] : []
			)
		);
	}
	if (target.contexts) target.contexts = projectContexts(target.contexts);
	if (target.request) {
		const { method, url: rawUrl, headers } = target.request;
		const userAgent = Object.entries(headers ?? {}).find(
			([key]) => key.toLowerCase() === 'user-agent'
		);
		target.request = {
			method,
			url: rawUrl === undefined ? undefined : requestUrl(rawUrl),
			...(userAgent ? { headers: { [userAgent[0]]: redactText(userAgent[1]) } } : {})
		};
	}
	// A transaction named after its path keeps no name of it; ingestion needs one.
	if (target.transaction !== undefined) {
		target.transaction = named
			? `${named.method ? `${named.method} ` : ''}${named.route}`
			: REDACTED;
	}
	if (target.spans) {
		target.spans = target.spans.map((span) => ({
			span_id: span.span_id,
			trace_id: span.trace_id,
			parent_span_id: span.parent_span_id,
			op: span.op,
			status: span.status,
			origin: span.origin,
			start_timestamp: span.start_timestamp,
			timestamp: span.timestamp,
			description: span.description === undefined ? undefined : spanUrl(span.description),
			data: sdkAttributes(span.data)
		}));
	}
	return event;
}

const TRACE_ID = /^[0-9a-f]{32}$/;
const SAMPLE_NUMBER = /^(?:0|1|0?\.\d{1,20}|1\.0{1,20})$/;

/**
 * Reduces an envelope header's trace context in place to the trace id, the
 * client's own public key and the sampling values, each checked against its
 * format. The SDK builds the context after every event hook, from an inbound
 * request's baggage when there is one, and baggage carries whatever the caller
 * wrote: `sentry-transaction`, `sentry-release`, `sentry-environment`. A trace
 * id that is not one removes the context.
 */
export function projectEnvelopeTrace(
	header: { [field: string]: unknown },
	publicKey: string | undefined
): void {
	const trace = header.trace;
	if (typeof trace !== 'object' || trace === null) return;
	const field = (name: string): string | undefined => {
		const value: unknown = Reflect.get(trace, name);
		return typeof value === 'string' ? value : undefined;
	};
	const traceId = field('trace_id');
	if (!traceId || !TRACE_ID.test(traceId)) {
		delete header.trace;
		return;
	}
	const key = field('public_key');
	const sampled = field('sampled');
	const rate = field('sample_rate');
	const rand = field('sample_rand');
	header.trace = {
		trace_id: traceId,
		...(publicKey && key === publicKey ? { public_key: key } : {}),
		...(sampled === 'true' || sampled === 'false' ? { sampled } : {}),
		...(rate && SAMPLE_NUMBER.test(rate) ? { sample_rate: rate } : {}),
		...(rand && SAMPLE_NUMBER.test(rand) ? { sample_rand: rand } : {})
	};
}
