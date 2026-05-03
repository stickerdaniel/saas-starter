import { PASSTHROUGH_MIMES } from './config.js';

/** Detect animated GIF by counting Graphic Control Extension blocks (0x21 0xF9). */
export async function isAnimatedGif(blob: Blob): Promise<boolean> {
	if (blob.type !== 'image/gif') return false;
	const buffer = await blob.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	let count = 0;
	for (let i = 0; i < bytes.length - 1; i++) {
		if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) {
			count++;
			if (count > 1) return true;
		}
	}
	return false;
}

export function isSvg(blob: Blob): boolean {
	return blob.type === 'image/svg+xml';
}

/** True if the blob should bypass the WebP encode pipeline. */
export async function shouldPassthrough(blob: Blob): Promise<boolean> {
	if (PASSTHROUGH_MIMES.has(blob.type)) return true;
	if (await isAnimatedGif(blob)) return true;
	return false;
}
