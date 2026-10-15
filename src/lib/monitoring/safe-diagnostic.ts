/**
 * One console line for a failure whose raw error can carry private input.
 *
 * Validation errors quote the value they rejected, provider errors carry the
 * response body, upload causes carry the backend message, and a request path or
 * query can hold a reset token. None of those reach the console, and shortening
 * them would not make them safe. What does reach it is the call site's fixed
 * label, a fresh id naming this occurrence, and the fields below.
 */

export interface SafeDiagnosticFields {
	/** A name from a closed set the call site owns, such as a frame kind. */
	operation?: string;
	/** HTTP status. Dropped unless it is an integer status code. */
	status?: number;
	/** An error code this repository defines, never a provider's. */
	code?: string;
	/** Request method. Anything but a standard method is written as `OTHER`. */
	method?: string;
	/**
	 * A route template such as `/api/auth/[...all]`, never the concrete path.
	 * `null` is SvelteKit's id for a request no route matched.
	 */
	route?: string | null;
}

type SafeDiagnosticLevel = 'error' | 'warn';

const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

// Every caller passes a literal or a route template, so this rejects nothing in
// practice. It keeps a value that slipped through from adding a field or a line.
// Parentheses stay: SvelteKit route ids keep their groups, as in `(auth)`.
const TOKEN = /^[\w.:/[\]()-]{1,120}$/;

function token(value: string): string {
	return TOKEN.test(value) ? value : 'invalid';
}

function diagnosticId(): string {
	// Not randomUUID: the browser exposes it only in secure contexts, and a LAN
	// dev origin is not one.
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function logSafeDiagnostic(
	level: SafeDiagnosticLevel,
	label: string,
	fields: SafeDiagnosticFields = {}
): void {
	const parts = [label, `diagnostic=${diagnosticId()}`];
	if (fields.operation !== undefined) parts.push(`operation=${token(fields.operation)}`);
	if (
		fields.status !== undefined &&
		Number.isInteger(fields.status) &&
		fields.status >= 100 &&
		fields.status <= 599
	) {
		parts.push(`status=${fields.status}`);
	}
	if (fields.code !== undefined) parts.push(`code=${token(fields.code)}`);
	if (fields.method !== undefined) {
		parts.push(`method=${HTTP_METHODS.has(fields.method) ? fields.method : 'OTHER'}`);
	}
	if (fields.route !== undefined) {
		parts.push(`route=${fields.route === null ? 'unmatched' : token(fields.route)}`);
	}
	if (level === 'error') console.error(parts.join(' '));
	else console.warn(parts.join(' '));
}
