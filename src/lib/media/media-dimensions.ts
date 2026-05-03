export interface MediaDimensions {
	width: number;
	height: number;
}

/** Decode an image blob via <img> to extract intrinsic dimensions. */
export function getImageDimensions(blob: Blob): Promise<MediaDimensions> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const objectUrl = URL.createObjectURL(blob);
		img.onload = () => {
			URL.revokeObjectURL(objectUrl);
			resolve({
				width: img.naturalWidth || img.width,
				height: img.naturalHeight || img.height
			});
		};
		img.onerror = () => {
			URL.revokeObjectURL(objectUrl);
			reject(new Error('Failed to load image'));
		};
		img.src = objectUrl;
	});
}

/** Read width/height from an SVG's viewBox; fall back to <img> decode. */
async function getSvgDimensions(blob: Blob): Promise<MediaDimensions> {
	try {
		const text = await blob.text();
		const match = text.match(/viewBox=["']([^"']+)["']/);
		const viewBox = match?.[1];
		if (viewBox) {
			const parts = viewBox.trim().split(/[\s,]+/);
			const w = parts[2];
			const h = parts[3];
			if (parts.length === 4 && w && h) {
				const width = parseFloat(w);
				const height = parseFloat(h);
				if (width > 0 && height > 0) {
					return { width: Math.round(width), height: Math.round(height) };
				}
			}
		}
	} catch {
		// fall through
	}
	return getImageDimensions(blob);
}

export function getMediaDimensions(blob: Blob): Promise<MediaDimensions> {
	if (blob.type === 'image/svg+xml') return getSvgDimensions(blob);
	return getImageDimensions(blob);
}
