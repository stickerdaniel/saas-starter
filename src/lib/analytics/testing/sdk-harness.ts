import { gunzipSync } from 'node:zlib';
import { vi } from 'vitest';

/** One event as PostHog's ingestion endpoint would receive it. */
export interface SentEvent {
	uuid: string;
	event: string;
	properties: Record<string, unknown>;
	$set?: Record<string, unknown>;
	$set_once?: Record<string, unknown>;
}

function decodeBody(url: string, body: unknown): unknown {
	const compression = new URL(url).searchParams.get('compression');
	let text: string;
	if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
		const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer);
		// The SDK drops the compression URL param for gzip bodies; sniff the gzip magic bytes.
		const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
		text = gzipped ? gunzipSync(bytes).toString('utf8') : new TextDecoder().decode(bytes);
	} else if (typeof body === 'string') {
		text = body;
	} else if (body instanceof Blob) {
		throw new Error('Blob bodies must be awaited before decoding');
	} else {
		return undefined;
	}
	if (compression === 'base64') {
		const encoded = decodeURIComponent(text.replace(/^data=/, ''));
		text = Buffer.from(encoded, 'base64').toString('utf8');
	}
	return JSON.parse(text);
}

/**
 * Stubs every browser transport the SDK can use and records decoded events.
 * Install once per test file, before the first posthog-js import: the SDK keeps the
 * transport functions it finds at load, so a stub installed later is never called.
 * Call `reset()` between tests instead of installing again.
 */
export function installNetworkRecorder() {
	const events: SentEvent[] = [];
	const urls: string[] = [];
	const decoding = new Set<Promise<void>>();

	function record(url: string, body: unknown): Promise<void> {
		const task = decode(url, body).finally(() => decoding.delete(task));
		decoding.add(task);
		return task;
	}

	async function decode(url: string, body: unknown): Promise<void> {
		urls.push(url);
		const resolved = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body;
		const decoded = decodeBody(url, resolved);
		if (!decoded) return;
		const batch = Array.isArray(decoded)
			? decoded
			: Array.isArray((decoded as { batch?: unknown }).batch)
				? (decoded as { batch: unknown[] }).batch
				: [decoded];
		for (const item of batch) events.push(item as SentEvent);
	}

	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			await record(String(input instanceof Request ? input.url : input), init?.body);
			return new Response('{"status":1}', { status: 200 });
		})
	);
	// Fail closed: a request the recorder does not decode must not pass silently. The
	// SDK constructs XMLHttpRequest for feature detection, so only sending throws.
	vi.stubGlobal(
		'XMLHttpRequest',
		class extends XMLHttpRequest {
			override send(): void {
				throw new Error('Unexpected XMLHttpRequest from the SDK; extend the recorder');
			}
		}
	);
	Object.defineProperty(navigator, 'sendBeacon', {
		configurable: true,
		value: (url: string, data?: BodyInit | null) => {
			void record(url, data);
			return true;
		}
	});
	// With native CompressionStream the SDK gzips off the main thread and calls the
	// transport only when zlib finishes, which a loaded runner delays past any flush
	// window. Without it the SDK gzips synchronously and hands each unbatched event
	// to the transport inside capture(), so "nothing was sent" is a sound assertion.
	vi.stubGlobal('CompressionStream', undefined);

	return {
		events,
		urls,
		reset(): void {
			events.length = 0;
			urls.length = 0;
		},
		/**
		 * Waits for SDK timers due within `ms`, then for every recorded body to be decoded.
		 * Timers fire in due order, so load delays this wait but cannot reorder it.
		 */
		async flush(ms = 30): Promise<void> {
			await new Promise((resolve) => setTimeout(resolve, ms));
			await Promise.all(decoding);
		},
		serialized(): string {
			return JSON.stringify(events);
		}
	};
}

/** Clears every store the SDK can touch in jsdom. */
export function resetBrowserStores(): void {
	localStorage.clear();
	sessionStorage.clear();
	for (const cookie of document.cookie.split(';')) {
		const name = cookie.split('=')[0]?.trim();
		if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
	}
}
