// Credential redaction. Runtime-neutral, because the SvelteKit server (Node or
// Workers) and the browser both import it through the Sentry projection:
// relative imports only, no SDK, no runtime API.
//
// The rest of the text stays. What goes is anything that authenticates: a JWT,
// an auth header value, a write grant or signature, a credential in a URL query
// or path, a cookie.

const FILTERED = '[Filtered]';

// A failure path redacts whatever a provider sent back, so no pattern below
// rescans a long run from each position inside it: each starts after a
// non-word character or a separator, bounds what it scans, or takes the whole
// run at once. The whole text is redacted and the result cut, because a cut
// before redaction splits a credential so that no pattern matches either half.
const MAX_TEXT_CHARS = 64 * 1024;
// Beyond this, text is cut before redaction to bound the work, and the cut
// fails closed: the run of token characters before it goes, and a credential
// value it leaves open goes to the end like any other open value.
const MAX_INPUT_CHARS = 1024 * 1024;
const TOKEN_CHAR = /[\w.~+/=|:%\\-]/;
const MAX_CUT_RUN = 4096;

// Better Auth names its endpoint in the first segment after `/api/auth/` and
// carries credentials in later ones (`/api/auth/reset-password/<token>`). Every
// later segment goes, so an endpoint added later cannot leak one either; the
// route template `/api/auth/[...all]` has no later segment and stays.
const AUTH_PATH = /(\/api\/auth\/[^/?#\s"'`]+)\/[^?#\s"'`]*/g;
// A Convex storage path is a bearer capability whatever alphabet its id uses.
const STORAGE_PATH = /(\/api\/storage)\/[^?#\s"'`]+/g;

// Query, fragment and form values whose key names a credential, or a URL that
// can carry one in its own query (`callbackURL`, `redirect_uri`). The value ends
// at the next separator, so an encoded nested URL goes with its key. The key is
// matched decoded, because `URLSearchParams` reads `?%74oken=` as `token` and the
// reset page reads its token that way.
const CREDENTIAL_PARAMETER_KEY =
	/token|code|secret|key|password|otp|state|url|uri|redirect|callback|return|sig|grant|auth/i;
const PARAMETER = /(^|[?&;#\s])([^=&;#?\s"'`]+)=[^&;#\s"'`]*/g;

// A key whose value authenticates. Matched at the end of the name, so
// `writeGrant`, `gatewaySignature`, `accessToken` and `x-api-key` go, while
// `maxTokens` and `tokenCount` stay.
const CREDENTIAL_KEY =
	/(?:grant|signature|token|secret|password|passwd|api[_-]?key|authorization|cookie)$/i;

// Grants, their digests and signatures are 64 hex digits, and a rejected call
// can echo them inside its message.
const HEX_SECRET = /[0-9a-f]{64,}/gi;
// Three base64url segments whose header starts `{"`.
const JWT = /(?<![\w-])eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*/g;
const BEARER = /\b(Bearer|Basic)\s+[\w.~+/=-]{6,}/gi;
// A Convex admin or deploy key: `<deployment>|<key>`.
const CONVEX_KEY = /\bConvex\s+[\w.:-]+\|[\w.+/=-]+/g;
const PROVIDER_KEY = /(?<![\w-])(?:sk|rk|pk)-(?:proj-|live-|test-)?[\w-]{20,}/g;
// A header written out as text keeps its name; the rest of its line goes, or
// of the next line when the value wraps onto it indented. A quoted or array
// value, on either line, is left to KEYED_VALUE, which finds where it closes.
const HEADER_LINE =
	/(?<![\w-])((?:proxy-)?authorization|(?:set-)?cookie|x-[\w-]{0,64}?(?:signature|token|api-key))\s*:[ \t]*(?:\r?\n[ \t]+)?(?![ \t\r\n]|\\*["'[])[^\r\n]+/gi;
// `key: value`, `key=value` and their quoted forms, also inside serialized
// payloads where the quotes arrive escaped once or more
// (`{\"writeGrant\":\"…\"}`), and with an array or object value. Text that
// parses as JSON is redacted by field instead (`redactSerialized`); these
// shapes cover what does not parse, such as a cut or malformed payload.
const CREDENTIAL_KEY_PART = String.raw`(?<![\w-])[\w-]{0,64}(?:grant|signature|token|secret|password|passwd|api[_-]?key|authorization|cookie)(?:\\*["'])?\s*[:=]\s*`;
const CLOSED_VALUE = String.raw`\\+"(?:[^"\\]|\\+[^"\\])*\\+"|"(?:[^"\\]|\\.)*"|'[^']*'|\[[^[\]]*\]|\{[^{}]*\}|[^\s,;{}&[\])"'\\]+`;
// A quote, array or object the text never closes, or an object holding
// another, because a provider or a cut ended it early: the value runs to the
// end of the text, which may span lines.
const OPEN_VALUE = String.raw`\\*["'[{][\s\S]*`;
const KEYED_VALUE = new RegExp(
	String.raw`(${CREDENTIAL_KEY_PART})(?!\\*["']?\[Filtered\])(${CLOSED_VALUE}|${OPEN_VALUE})`,
	'gi'
);
const ABSOLUTE_URL = /\bhttps?:\/\/[^\s"'<>`\\]+/gi;
const USERINFO = /^(https?:\/\/)[^/?#@]+@/i;
// A path segment that reads like a key: long, from a token alphabet, with a
// digit. Storage URLs (`/api/storage/<uuid>`) and signed
// download paths are bearer capabilities; an id in a URL path goes with them,
// which costs nothing because every record carries its ids as fields.
const TOKEN_SEGMENT = /\/(?=[\w-]*\d)[\w-]{16,}(?=[/?#]|$)/g;

function decodedKey(key: string): string {
	try {
		return decodeURIComponent(key.replaceAll('+', ' '));
	} catch {
		return key;
	}
}

/** Whether a query key, decoded, names a credential or a URL that can carry one. */
function isCredentialParameter(key: string): boolean {
	return CREDENTIAL_PARAMETER_KEY.test(decodedKey(key));
}

function quoted(value: string): string {
	const quote = /^\\*["']/.exec(value)?.[0];
	return quote ? `${quote}${FILTERED}${quote}` : FILTERED;
}

function precut(text: string): string {
	let end = MAX_INPUT_CHARS;
	const floor = end - MAX_CUT_RUN;
	while (end > floor && TOKEN_CHAR.test(text.charAt(end - 1))) end -= 1;
	return text.slice(0, end);
}

function redactUrl(url: string): string {
	const pathStart = url.indexOf('/', url.indexOf('//') + 2);
	if (pathStart === -1) return url.replace(USERINFO, `$1${FILTERED}@`);
	const origin = url.slice(0, pathStart).replace(USERINFO, `$1${FILTERED}@`);
	return origin + url.slice(pathStart).replace(TOKEN_SEGMENT, `/${FILTERED}`);
}

/**
 * `text` with every credential shape this module knows replaced by `[Filtered]`,
 * then cut to its first 64 KiB with a `[truncated N chars]` marker.
 */
export function redactText(text: string): string {
	const input = text.length > MAX_INPUT_CHARS ? precut(text) : text;
	const redacted = redactSerialized(input) ?? redactShapes(input);
	const dropped = text.length - input.length + Math.max(0, redacted.length - MAX_TEXT_CHARS);
	return dropped > 0
		? `${redacted.slice(0, MAX_TEXT_CHARS)}[truncated ${dropped} chars]`
		: redacted;
}

/**
 * A JSON object or array in `text`, redacted as the value it holds and written
 * back as JSON, or `undefined` when `text` is not one. Field names are read
 * decoded and a credential field goes whole whatever its value, which the shape
 * rules cannot do: `{"token":…}` and `{"token":{"value":…}}` keep their
 * credential to a pattern over the text.
 */
function redactSerialized(text: string): string | undefined {
	const first = text.trimStart().charAt(0);
	if (first !== '{' && first !== '[') return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	return JSON.stringify(redactCredentials(parsed));
}

function redactShapes(text: string): string {
	return text
		.replace(HEADER_LINE, `$1: ${FILTERED}`)
		.replace(JWT, FILTERED)
		.replace(BEARER, `$1 ${FILTERED}`)
		.replace(CONVEX_KEY, `Convex ${FILTERED}`)
		.replace(PROVIDER_KEY, FILTERED)
		.replace(KEYED_VALUE, (_match, key: string, value: string) => `${key}${quoted(value)}`)
		.replace(HEX_SECRET, FILTERED)
		.replace(ABSOLUTE_URL, redactUrl)
		.replace(AUTH_PATH, `$1/${FILTERED}`)
		.replace(STORAGE_PATH, `$1/${FILTERED}`)
		.replace(PARAMETER, (parameter, separator: string, key: string) =>
			isCredentialParameter(key) ? `${separator}${key}=${FILTERED}` : parameter
		);
}

/** Whether a field of that name holds a credential, whatever its value. */
function isCredentialKey(key: string): boolean {
	return CREDENTIAL_KEY.test(key);
}

// Records are small trees; the bound stops a cycle or a deep chain from
// stalling the caller's failure path.
const MAX_DEPTH = 12;

export function isPlainObject(value: object): value is Record<string, unknown> {
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
	if (typeof value === 'string') return redactText(value);
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'function' || typeof value === 'symbol') return undefined;
	if (value === null || typeof value !== 'object') return value;
	if (seen.has(value)) return '[circular]';
	if (depth >= MAX_DEPTH) return '[depth]';
	seen.add(value);
	try {
		if (Array.isArray(value)) return value.map((item) => redactValue(item, seen, depth + 1));
		// A class instance would serialize whatever it owns; its text form is
		// what it chose to show.
		if (!isPlainObject(value)) return redactText(String(value));
		const copy: Record<string, unknown> = {};
		for (const key of Object.keys(value)) {
			copy[key] = isCredentialKey(key) ? FILTERED : redactValue(value[key], seen, depth + 1);
		}
		return copy;
	} catch {
		return '[unreadable]';
	} finally {
		seen.delete(value);
	}
}

/**
 * A copy of `value` with credentials removed: by shape inside every string, and
 * by key name for whole fields. Plain objects and arrays are copied; any other
 * object becomes its redacted text. Never throws and never mutates the input.
 */
export function redactCredentials(value: unknown): unknown {
	return redactValue(value, new WeakSet(), 0);
}
