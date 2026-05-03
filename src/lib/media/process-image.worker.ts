/// <reference lib="webworker" />
/**
 * Image processing worker. Decodes a blob (or accepts a transferred ImageBitmap),
 * resizes to fit a longest-side cap, encodes WebP via @jsquash/webp.
 */
import { encode as encodeWebP } from '@jsquash/webp';

declare const self: DedicatedWorkerGlobalScope;

interface ProcessRequest {
	type: 'process';
	id: number;
	blob?: Blob;
	bitmap?: ImageBitmap;
	maxWidth: number;
	quality: number;
}

type ProcessResponse =
	| { type: 'status'; id: number; status: string }
	| {
			type: 'result';
			id: number;
			buffer: ArrayBuffer;
			width: number;
			height: number;
	  }
	| { type: 'error'; id: number; error: string };

function postStatus(id: number, status: string) {
	const msg: ProcessResponse = { type: 'status', id, status };
	self.postMessage(msg);
}

async function handleProcess(req: ProcessRequest) {
	try {
		postStatus(req.id, 'Decoding');
		const bitmap: ImageBitmap = req.bitmap ?? (await createImageBitmap(req.blob!));

		const longest = Math.max(bitmap.width, bitmap.height);
		const scale = longest > req.maxWidth ? req.maxWidth / longest : 1;
		// Clamp to at least 1 px on either axis. Without this, very thin sources
		// (e.g. 1×10000) round to 0 on the short side and OffscreenCanvas throws.
		const targetW = Math.max(1, Math.round(bitmap.width * scale));
		const targetH = Math.max(1, Math.round(bitmap.height * scale));

		postStatus(req.id, 'Resizing');
		const canvas = new OffscreenCanvas(targetW, targetH);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
		ctx.drawImage(bitmap, 0, 0, targetW, targetH);
		bitmap.close();
		const imageData = ctx.getImageData(0, 0, targetW, targetH);

		postStatus(req.id, 'Encoding');
		const buffer = await encodeWebP(imageData, { quality: req.quality });

		postStatus(req.id, 'Done');
		const msg: ProcessResponse = {
			type: 'result',
			id: req.id,
			buffer,
			width: targetW,
			height: targetH
		};
		self.postMessage(msg, { transfer: [buffer] });
	} catch (err) {
		const msg: ProcessResponse = {
			type: 'error',
			id: req.id,
			error: err instanceof Error ? err.message : 'Image processing failed'
		};
		self.postMessage(msg);
	}
}

self.addEventListener('message', (e: MessageEvent<ProcessRequest>) => {
	if (e.data?.type === 'process') {
		handleProcess(e.data);
	}
});
