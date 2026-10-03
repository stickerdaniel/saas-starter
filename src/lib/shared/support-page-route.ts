export const SUPPORT_PAGE_ROUTE_MAX_BYTES = 2048;

const HTTP_URL_PREFIX = /^https?:\/\//i;
const ROUTE_BASE = 'https://support-route.invalid';
const encoder = new TextEncoder();

function exceedsRouteLimit(value: string): boolean {
	return encoder.encode(value).byteLength > SUPPORT_PAGE_ROUTE_MAX_BYTES;
}

function hasForbiddenInput(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (character === '\\' || code <= 31 || code === 127) return true;
	}
	return false;
}

/**
 * Reduces optional support-page metadata to a bounded same-origin pathname.
 * Invalid metadata is omitted so it cannot make the enclosing write fail.
 */
export function normalizeSupportPageRoute(value: string | undefined): string | undefined {
	if (!value || exceedsRouteLimit(value) || hasForbiddenInput(value)) return undefined;

	let url: URL;
	try {
		if (value.startsWith('/')) {
			if (value.startsWith('//')) return undefined;
			url = new URL(value, ROUTE_BASE);
		} else {
			if (!HTTP_URL_PREFIX.test(value)) return undefined;
			url = new URL(value);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
		}
	} catch {
		return undefined;
	}

	const pathname = url.pathname;
	if (!pathname.startsWith('/') || pathname.startsWith('//') || exceedsRouteLimit(pathname)) {
		return undefined;
	}
	return pathname;
}
