import { ConvexError } from 'convex/values';
import { t } from '../i18n/translations';

/**
 * Max bytes of attachment text returned to the client for the preview dialog.
 * The client renderer also caps; both layers cap so a large object is never
 * fully read on either side.
 */
export const MAX_PREVIEW_TEXT_SIZE = 256 * 1024; // 256KB

const PREVIEWABLE_MIME_EXACT = new Set(['application/json', 'application/xml']);

/**
 * SSRF guard: a previewable attachment URL must live on this deployment's own
 * Convex storage origin (`cloudOrigin`, i.e. CONVEX_CLOUD_URL) and use the
 * storage path. Returns false for foreign origins, non-storage paths, unparsable
 * URLs, and a missing/unparsable cloud origin (fail closed).
 */
export function isAllowedStorageUrl(url: string, cloudOrigin: string | undefined): boolean {
	if (!cloudOrigin) return false;
	let target: URL;
	let allowed: URL;
	try {
		target = new URL(url);
		allowed = new URL(cloudOrigin);
	} catch {
		return false;
	}
	return target.origin === allowed.origin && target.pathname.startsWith('/api/storage/');
}

function isPreviewableContentType(contentType: string): boolean {
	const essence = contentType.split(';')[0]!.trim().toLowerCase();
	if (!essence) return false;
	if (essence.startsWith('text/')) return true;
	return PREVIEWABLE_MIME_EXACT.has(essence);
}

/**
 * Read a chat attachment's text content server-side for the preview dialog.
 *
 * CORS-independent (Convex storage URLs do not send Access-Control-Allow-Origin,
 * so a browser cannot read them cross-origin; the server can). SSRF-guarded: the
 * URL must point at this deployment's own Convex storage origin and storage path.
 * Bounded read so an oversized or binary object is never fully decoded.
 *
 * @throws {ConvexError} when the URL is not this deployment's storage, the fetch
 *   fails, or the content type is not text-like.
 */
export async function fetchAttachmentText(
	url: string,
	locale?: string
): Promise<{ text: string; truncated: boolean }> {
	// SSRF guard. CONVEX_CLOUD_URL is a Convex system env var (available in app
	// functions on cloud and self-hosted) and is the origin ctx.storage.getUrl()
	// serves from. Fail closed if it is unset or the URL is not our storage.
	if (!isAllowedStorageUrl(url, process.env.CONVEX_CLOUD_URL)) {
		throw new ConvexError(t(locale, 'backend.files.fetch_failed'));
	}

	const response = await fetch(url, { redirect: 'manual' });
	if (!response.ok) {
		throw new ConvexError(t(locale, 'backend.files.fetch_failed'));
	}

	if (!isPreviewableContentType(response.headers.get('content-type') ?? '')) {
		throw new ConvexError(t(locale, 'backend.files.type_not_allowed'));
	}

	// Bounded read: stop once we have MAX_PREVIEW_TEXT_SIZE bytes so a large
	// object is never fully buffered/decoded.
	const reader = response.body?.getReader();
	if (!reader) {
		const whole = await response.text();
		return {
			text: whole.slice(0, MAX_PREVIEW_TEXT_SIZE),
			truncated: whole.length > MAX_PREVIEW_TEXT_SIZE
		};
	}

	const chunks: Uint8Array[] = [];
	let total = 0;
	let truncated = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				chunks.push(value);
				total += value.byteLength;
				if (total >= MAX_PREVIEW_TEXT_SIZE) {
					truncated = true;
					break;
				}
			}
		}
	} finally {
		await reader.cancel().catch(() => {});
	}

	const limit = Math.min(total, MAX_PREVIEW_TEXT_SIZE);
	const buf = new Uint8Array(limit);
	let offset = 0;
	for (const chunk of chunks) {
		if (offset >= limit) break;
		const take = Math.min(chunk.byteLength, limit - offset);
		buf.set(chunk.subarray(0, take), offset);
		offset += take;
	}
	// TextDecoder is non-fatal by default: a UTF-8 sequence cut at the cap
	// boundary degrades to U+FFFD rather than throwing.
	const text = new TextDecoder().decode(buf);
	return { text, truncated };
}
