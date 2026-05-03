import { PASSTHROUGH_MIMES } from './config.js';

/**
 * Detect animated GIF by walking the GIF block structure and counting image
 * descriptors (`0x2C` blocks at the top level). A static GIF has exactly one;
 * an animated GIF has at least two.
 *
 * A naive byte-scan for `0x21 0xF9` (Graphic Control Extension introducer)
 * produces false positives because LZW-compressed image data and other
 * extension blocks can contain that pair, which wrongly classifies static
 * GIFs as animated and bypasses compression. This walker is robust because
 * it follows the documented GIF structure: header, logical screen
 * descriptor, optional global color table, then a stream of typed blocks
 * separated by trailers.
 *
 * Spec: https://www.w3.org/Graphics/GIF/spec-gif89a.txt
 */
export async function isAnimatedGif(blob: Blob): Promise<boolean> {
	if (blob.type !== 'image/gif') return false;
	const buffer = await blob.arrayBuffer();
	const bytes = new Uint8Array(buffer);

	// 6-byte signature ("GIF87a" or "GIF89a") + 7-byte logical screen descriptor.
	if (bytes.length < 13) return false;
	if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return false;

	// Optional Global Color Table size lives in the packed byte at offset 10.
	const packed = bytes[10] ?? 0;
	const hasGCT = (packed & 0x80) !== 0;
	const gctSize = hasGCT ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
	let i = 13 + gctSize;

	let imageCount = 0;
	while (i < bytes.length) {
		const block = bytes[i];
		if (block === 0x3b) {
			// Trailer
			break;
		}
		if (block === 0x2c) {
			// Image descriptor — fixed 10 bytes (incl. introducer), optional Local
			// Color Table, then LZW image data sub-blocks.
			imageCount++;
			if (imageCount > 1) return true;
			if (i + 10 > bytes.length) return false;
			const lpacked = bytes[i + 9] ?? 0;
			const hasLCT = (lpacked & 0x80) !== 0;
			const lctSize = hasLCT ? 3 * (1 << ((lpacked & 0x07) + 1)) : 0;
			i += 10 + lctSize;
			// Skip the LZW minimum code size byte, then walk sub-blocks.
			if (i >= bytes.length) return false;
			i += 1;
			i = skipSubBlocks(bytes, i);
			if (i < 0) return false;
			continue;
		}
		if (block === 0x21) {
			// Extension introducer: skip label byte, then sub-blocks.
			i += 2;
			i = skipSubBlocks(bytes, i);
			if (i < 0) return false;
			continue;
		}
		// Unknown byte — treat as malformed; bail out without claiming animation.
		return false;
	}
	return false;
}

function skipSubBlocks(bytes: Uint8Array, offset: number): number {
	let i = offset;
	while (i < bytes.length) {
		const size = bytes[i];
		if (size === undefined) return -1;
		if (size === 0) return i + 1;
		i += 1 + size;
	}
	return -1;
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
