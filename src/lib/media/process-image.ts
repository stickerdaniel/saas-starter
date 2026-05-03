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
	worker.addEventListener('error', (e) => {
		// Reject every in-flight request so callers fall back to passthrough.
		const error = new Error(e.message || 'Image worker crashed');
		for (const entry of pending.values()) entry.reject(error);
		pending.clear();
	});
	workerInstance = worker;
	return worker;
}

async function canvasToBitmap(canvas: HTMLCanvasElement): Promise<ImageBitmap> {
	return await createImageBitmap(canvas);
}

async function blobFromCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
	return await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
			'image/png'
		);
	});
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
		// 3. Fallback: hand back the original bytes (or a PNG snapshot of the canvas)
		//    so the upload still succeeds. Log so we can see WASM/worker failures.
		console.warn('processImage falling back to passthrough:', err);
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
		if (input instanceof HTMLCanvasElement) {
			const blob = await blobFromCanvas(input);
			return {
				blob,
				width: input.width,
				height: input.height,
				mimeType: 'image/png',
				passthrough: true
			};
		}
		// ImageBitmap fallback: encode to a PNG via OffscreenCanvas on the main thread.
		const c = new OffscreenCanvas(input.width, input.height);
		const ctx = c.getContext('2d');
		if (!ctx) throw err;
		ctx.drawImage(input, 0, 0);
		const blob = await c.convertToBlob({ type: 'image/png' });
		return {
			blob,
			width: input.width,
			height: input.height,
			mimeType: 'image/png',
			passthrough: true
		};
	}
}
