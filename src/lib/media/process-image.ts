/**
 * Client-side image processor. Resizes to a longest-side cap and encodes
 * WebP via @jsquash/webp running in a Web Worker (lazy-initialised, WASM
 * stays out of the main bundle).
 *
 * Used by every image input surface in the app: screenshot editor, chat
 * clipboard paste, chat file picker. Falls back to passthrough on decode
 * or encode failure so the user can still upload the original blob.
 */
import { browser } from '$app/environment';
import { MAX_IMAGE_WIDTH, WEBP_QUALITY } from './config.js';
import { shouldPassthrough } from './detect-passthrough.js';
import { getMediaDimensions } from './media-dimensions.js';

export type ProcessImageInput = Blob | HTMLCanvasElement | ImageBitmap;

export interface ProcessImageOptions {
	maxWidth?: number;
	quality?: number;
	onStatus?: (status: string) => void;
}

export interface ProcessedImage {
	blob: Blob;
	width: number;
	height: number;
	mimeType: string;
	/** True when the original bytes were forwarded unchanged (SVG, animated GIF, decode failure). */
	passthrough: boolean;
}

interface PendingRequest {
	resolve: (value: { buffer: ArrayBuffer; width: number; height: number }) => void;
	reject: (err: Error) => void;
	onStatus?: (status: string) => void;
}

type WorkerMessage =
	| { type: 'status'; id: number; status: string }
	| { type: 'result'; id: number; buffer: ArrayBuffer; width: number; height: number }
	| { type: 'error'; id: number; error: string };

let workerInstance: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function destroyWorker(reason: Error) {
	const worker = workerInstance;
	workerInstance = null;
	for (const entry of pending.values()) entry.reject(reason);
	pending.clear();
	if (worker) {
		try {
			worker.terminate();
		} catch {
			// best-effort cleanup
		}
	}
}

function getWorker(): Worker {
	if (workerInstance) return workerInstance;
	const worker = new Worker(new URL('./process-image.worker.ts', import.meta.url), {
		type: 'module'
	});
	worker.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
		const msg = e.data;
		const entry = pending.get(msg.id);
		if (!entry) return;
		if (msg.type === 'status') {
			entry.onStatus?.(msg.status);
			return;
		}
		pending.delete(msg.id);
		if (msg.type === 'error') {
			entry.reject(new Error(msg.error));
			return;
		}
		entry.resolve({ buffer: msg.buffer, width: msg.width, height: msg.height });
	});
	// Worker-level fatal errors (script load failure, uncaught throw, OOM) and
	// structured-clone failures both leave the worker unusable. Reject in-flight
	// requests, terminate the worker, and null the singleton so the next
	// processImage() call can spawn a fresh one.
	worker.addEventListener('error', (e) => {
		destroyWorker(new Error(e.message || 'Image worker crashed'));
	});
	worker.addEventListener('messageerror', () => {
		destroyWorker(new Error('Image worker received an undeserializable message'));
	});
	workerInstance = worker;
	return worker;
}

async function canvasToBitmap(canvas: HTMLCanvasElement): Promise<ImageBitmap> {
	return await createImageBitmap(canvas);
}

/**
 * Main-thread resize + encode used as a fallback when the worker / WASM init
 * fails. This still gives us the most important property of the pipeline —
 * the output fits the server-side 5 MB cap even for large screenshots — by
 * resizing to `maxWidth` on a regular canvas and encoding via the browser's
 * native `canvas.toBlob`.
 *
 * Native `canvas.toBlob('image/webp', q)` is materially lower fidelity than
 * `@jsquash/webp.encode`, especially on text-heavy screenshots, but it's
 * still vastly smaller than a raw PNG and keeps uploads working.
 */
async function fallbackResizeAndEncode(
	source: HTMLCanvasElement | ImageBitmap,
	sourceW: number,
	sourceH: number,
	maxWidth: number
): Promise<{ blob: Blob; mimeType: string; width: number; height: number }> {
	const longest = Math.max(sourceW, sourceH);
	const scale = longest > maxWidth ? maxWidth / longest : 1;
	const targetW = Math.max(1, Math.round(sourceW * scale));
	const targetH = Math.max(1, Math.round(sourceH * scale));

	const canvas = document.createElement('canvas');
	canvas.width = targetW;
	canvas.height = targetH;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D context unavailable on fallback canvas');
	ctx.drawImage(source, 0, 0, targetW, targetH);

	// Try WebP first; fall back to PNG if the browser refused (returned null).
	const webp = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob((b) => resolve(b), 'image/webp', 0.85)
	);
	if (webp) return { blob: webp, mimeType: 'image/webp', width: targetW, height: targetH };
	const png = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob((b) => resolve(b), 'image/png')
	);
	if (!png) throw new Error('canvas.toBlob returned null for both webp and png');
	return { blob: png, mimeType: 'image/png', width: targetW, height: targetH };
}

function postProcess(input: {
	bitmap?: ImageBitmap;
	blob?: Blob;
	maxWidth: number;
	quality: number;
	onStatus?: (s: string) => void;
}): Promise<{ buffer: ArrayBuffer; width: number; height: number }> {
	return new Promise((resolve, reject) => {
		const worker = getWorker();
		const id = nextRequestId++;
		pending.set(id, { resolve, reject, onStatus: input.onStatus });
		const transfer: Transferable[] = [];
		if (input.bitmap) transfer.push(input.bitmap);
		try {
			worker.postMessage(
				{
					type: 'process',
					id,
					bitmap: input.bitmap,
					blob: input.blob,
					maxWidth: input.maxWidth,
					quality: input.quality
				},
				transfer
			);
		} catch (err) {
			// postMessage can throw on structured-clone failures (rare but possible
			// for exotic Blob/ImageBitmap states). Drop the pending entry so the
			// map doesn't leak across the session.
			pending.delete(id);
			reject(err instanceof Error ? err : new Error(String(err)));
		}
	});
}

export async function processImage(
	input: ProcessImageInput,
	opts: ProcessImageOptions = {}
): Promise<ProcessedImage> {
	const maxWidth = opts.maxWidth ?? MAX_IMAGE_WIDTH;
	const quality = opts.quality ?? WEBP_QUALITY;

	if (!browser) {
		throw new Error('processImage is browser-only');
	}

	// 1. Passthrough fast path for Blob inputs we should not re-encode.
	if (input instanceof Blob && (await shouldPassthrough(input))) {
		const dims = await getMediaDimensions(input).catch(() => ({ width: 0, height: 0 }));
		return {
			blob: input,
			width: dims.width,
			height: dims.height,
			mimeType: input.type,
			passthrough: true
		};
	}

	// 2. Worker path. Convert HTMLCanvasElement → ImageBitmap up front so we can
	//    transfer it; pass Blob through directly (structured-clone is fine).
	try {
		let bitmap: ImageBitmap | undefined;
		let blob: Blob | undefined;

		if (input instanceof Blob) {
			blob = input;
		} else if (typeof ImageBitmap !== 'undefined' && input instanceof ImageBitmap) {
			bitmap = input;
		} else if (input instanceof HTMLCanvasElement) {
			bitmap = await canvasToBitmap(input);
		} else {
			throw new Error('Unsupported processImage input');
		}

		const { buffer, width, height } = await postProcess({
			bitmap,
			blob,
			maxWidth,
			quality,
			onStatus: opts.onStatus
		});

		return {
			blob: new Blob([buffer], { type: 'image/webp' }),
			width,
			height,
			mimeType: 'image/webp',
			passthrough: false
		};
	} catch (err) {
		// 3. Fallback path — worker/WASM init or encode failed. Still resize and
		//    encode on the main thread so the output respects the same upload
		//    cap as the happy path; without this, a passthrough of a 4K
		//    screenshot exceeds the 5 MB server-side limit and the upload fails.
		//    Note: `passthrough` is `false` here because the bytes have been
		//    transformed (resize + WebP/PNG re-encode); the field marks
		//    "untransformed", not "fell off the worker path".
		console.warn('processImage falling back to main-thread encode:', err);
		try {
			if (input instanceof HTMLCanvasElement) {
				const out = await fallbackResizeAndEncode(input, input.width, input.height, maxWidth);
				return { ...out, passthrough: false };
			}
			if (typeof ImageBitmap !== 'undefined' && input instanceof ImageBitmap) {
				const out = await fallbackResizeAndEncode(input, input.width, input.height, maxWidth);
				return { ...out, passthrough: false };
			}
			if (input instanceof Blob) {
				const bitmap = await createImageBitmap(input);
				const out = await fallbackResizeAndEncode(bitmap, bitmap.width, bitmap.height, maxWidth);
				bitmap.close();
				return { ...out, passthrough: false };
			}
		} catch (fallbackErr) {
			console.warn('processImage main-thread fallback also failed:', fallbackErr);
		}

		// 4. Last resort — hand back the original bytes unchanged. Acceptable
		//    only for blob inputs where the original is already a valid file.
		if (input instanceof Blob) {
			const dims = await getMediaDimensions(input).catch(() => ({ width: 0, height: 0 }));
			return {
				blob: input,
				width: dims.width,
				height: dims.height,
				mimeType: input.type || 'application/octet-stream',
				passthrough: true
			};
		}
		throw err;
	}
}
