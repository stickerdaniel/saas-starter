// The original error of a failure as a credential-redacted record, and its
// serialization into bounded, numbered parts. Runtime-neutral, like redact.ts.

import { redactCredentials, redactText } from './redact';

export type DescribedError = {
	name: string;
	message: string;
	stack?: string;
	cause?: DescribedError;
};

// The cause chain that names a failure is short: a client error wrapping a
// transport error wrapping a socket error.
const CAUSE_DEPTH = 3;

function read(error: object, key: string): unknown {
	try {
		return Reflect.get(error, key);
	} catch {
		return undefined;
	}
}

function textOf(value: unknown): string {
	if (typeof value === 'string') return value;
	try {
		const json = JSON.stringify(redactCredentials(value));
		return json ?? String(value);
	} catch {
		return '[unserializable]';
	}
}

function describe(error: unknown, depth: number): DescribedError {
	if (typeof error !== 'object' || error === null) {
		return { name: error === null ? 'null' : typeof error, message: redactText(String(error)) };
	}
	const name = read(error, 'name');
	const message = read(error, 'message');
	const stack = read(error, 'stack');
	// A thrown plain object has no message; its own fields are the evidence.
	const evidence = message === undefined && !(error instanceof Error) ? error : (message ?? '');
	const described: DescribedError = {
		name: redactText(typeof name === 'string' && name ? name : 'Object'),
		message: redactText(textOf(evidence))
	};
	if (typeof stack === 'string') described.stack = redactText(stack);
	const cause = read(error, 'cause');
	if (cause !== undefined && depth < CAUSE_DEPTH) described.cause = describe(cause, depth + 1);
	return described;
}

/**
 * `{ name, message, stack, cause }` of any thrown value, credentials redacted,
 * causes followed three levels deep. Never throws, whatever the value's getters do.
 */
export function describeError(error: unknown): DescribedError {
	return describe(error, 0);
}

/**
 * The fields that join a record to the call, turn and session it belongs to.
 * They repeat on every part of a split record, and they are the only fields
 * the Sentry projection lets into the `correlation` context.
 */
export const CORRELATION_KEYS = [
	'chatId',
	'voiceSessionId',
	'responseId',
	'toolCallId',
	'diagnosticId',
	'convexRequestId',
	'functionPath'
] as const;

export type RecordPart = {
	event?: string;
	diagnosticId: string;
	part: number;
	of: number;
	chunk: string;
} & Partial<Record<(typeof CORRELATION_KEYS)[number], string>>;

const UNSERIALIZABLE = '[unserializable]';
// Provider ids arrive without a length bound. A part is bounded only if the
// fields repeated beside its chunk are.
const ID_CHARS = 256;

/** 16 hex digits from the platform CSPRNG, available in every runtime that imports this. */
export function newDiagnosticId(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// A repeated reference reads as `[circular]` too: cheaper than tracking the
// path, and a record is a tree in practice.
function serialize(record: Record<string, unknown>): string | null {
	const seen = new WeakSet<object>();
	try {
		return JSON.stringify(record, (_key, value: unknown) => {
			if (typeof value === 'bigint') return value.toString();
			if (typeof value === 'object' && value !== null) {
				if (seen.has(value)) return '[circular]';
				seen.add(value);
			}
			return value;
		});
	} catch {
		return null;
	}
}

/** \b, \t, \n, \f and \r, the control characters JSON writes in two bytes. */
const SHORT_ESCAPES = new Set([0x08, 0x09, 0x0a, 0x0c, 0x0d]);

// The bytes one code unit takes once the chunk holding it is written as a JSON
// string: quotes, backslashes and control characters with their escapes.
function escapedSize(code: number): number {
	if (code === 0x22 || code === 0x5c) return 2;
	if (code < 0x20) return SHORT_ESCAPES.has(code) ? 2 : 6;
	if (code < 0x80) return 1;
	if (code < 0x800) return 2;
	return 3;
}

function chunks(json: string, maxBytes: number): string[] {
	const parts: string[] = [];
	let start = 0;
	let bytes = 0;
	for (let index = 0; index < json.length; index += 1) {
		const code = json.charCodeAt(index);
		// Serialized JSON holds no lone surrogate, so a high one starts a pair
		// that stays in one chunk.
		const pair = code >= 0xd800 && code <= 0xdbff;
		const size = pair ? 4 : escapedSize(code);
		if (bytes + size > maxBytes && index > start) {
			parts.push(json.slice(start, index));
			start = index;
			bytes = 0;
		}
		bytes += size;
		if (pair) index += 1;
	}
	parts.push(json.slice(start));
	return parts;
}

/**
 * `record` serialized to JSON and split into numbered parts whose `chunk`,
 * written as a JSON string, takes at most `maxPartBytes` UTF-8 bytes. Joining
 * the chunks of one `diagnosticId` in `part` order gives the JSON back. The
 * record's correlation fields and `event` repeat on every part. Never throws:
 * a value JSON cannot hold becomes a placeholder.
 */
export function encodeRecord(record: Record<string, unknown>, maxPartBytes: number): RecordPart[] {
	const diagnosticId =
		typeof record.diagnosticId === 'string' && record.diagnosticId
			? record.diagnosticId
			: newDiagnosticId();
	const correlation: Partial<Record<(typeof CORRELATION_KEYS)[number], string>> = {};
	for (const key of CORRELATION_KEYS) {
		const value = record[key];
		if (typeof value === 'string' && value) correlation[key] = value.slice(0, ID_CHARS);
	}
	const event = typeof record.event === 'string' ? { event: record.event.slice(0, ID_CHARS) } : {};
	const json =
		serialize({ ...record, diagnosticId }) ??
		JSON.stringify({ ...event, ...correlation, diagnosticId, unserializable: UNSERIALIZABLE });
	const parts = chunks(json, maxPartBytes);
	return parts.map((chunk, index) => ({
		...event,
		...correlation,
		diagnosticId,
		part: index + 1,
		of: parts.length,
		chunk
	}));
}

/**
 * The log lines of one record: the record's own JSON when it fits in one part,
 * otherwise one JSON line per numbered part. Every line stays below
 * `maxPartBytes` plus its repeated fields.
 */
export function recordLines(record: Record<string, unknown>, maxPartBytes: number): string[] {
	const parts = encodeRecord(record, maxPartBytes);
	return parts.length === 1 ? [parts[0]!.chunk] : parts.map((part) => JSON.stringify(part));
}
