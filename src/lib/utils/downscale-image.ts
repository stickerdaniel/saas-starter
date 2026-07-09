/**
 * Downscale an image file client-side before upload.
 *
 * Avatars render at 48px or smaller, so uploading a full-size photo (e.g. a
 * 310KB camera PNG) only slows every later avatar load. Decodes via
 * `createImageBitmap` (respects EXIF orientation), draws onto a canvas capped
 * at `maxDim`, and re-encodes as WebP.
 *
 * Conservative by design: animated GIFs are passed through untouched (a canvas
 * draw would freeze the first frame), the re-encode is only used when it is
 * actually smaller than the original, and any decode/encode failure falls back
 * to the original file.
 */
export async function downscaleImage(file: File, maxDim = 512): Promise<Blob> {
	if (file.type === 'image/gif') return file;
	try {
		const bitmap = await createImageBitmap(file);
		try {
			const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
			const width = Math.max(1, Math.round(bitmap.width * scale));
			const height = Math.max(1, Math.round(bitmap.height * scale));
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (!ctx) return file;
			ctx.drawImage(bitmap, 0, 0, width, height);
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, 'image/webp', 0.85)
			);
			// An already-optimized small file can beat the WebP re-encode; keep
			// whichever is smaller.
			return blob && blob.size < file.size ? blob : file;
		} finally {
			bitmap.close();
		}
	} catch {
		return file;
	}
}
