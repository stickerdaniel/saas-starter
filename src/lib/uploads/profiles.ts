/**
 * What each upload surface accepts, declared once.
 *
 * Every client and server constant about accepted types and size caps derives
 * from a profile here, so the picker, the drop/paste gate and the server
 * validator cannot drift apart. They used to be three independent literals
 * (see #782), and the profile-image surface had already drifted.
 *
 * Which model or pipeline reads the files lives in `consumers.ts` instead, so
 * importing a profile in browser code does not pull model ids into the client
 * bundle. Imported by both browser and Convex code, so this module stays free
 * of Svelte, browser APIs and `convex/values`.
 */

export type UploadProfile = {
	/** Extension to mime type. What may be STORED, and what the server enforces. */
	extensions: Readonly<Record<string, string>>;
	/**
	 * Mime families a user may PICK, where that is wider than what is stored.
	 *
	 * Only meaningful on a surface with a transcoder in between. The avatar
	 * re-encodes to WebP before upload, so an iPhone's HEIC is a perfectly good
	 * input even though HEIC is never stored. Checking the picked file against
	 * the stored list would reject the platform default before the transcoder
	 * ever ran.
	 */
	sourceMimePrefixes?: readonly string[];
	maxBytes: number;
	maxBytesLabel: string;
	maxFiles: number;
};

export const UPLOAD_PROFILES = {
	/** Attachments on the AI chat and support surfaces. */
	chatAttachment: {
		extensions: {
			'.png': 'image/png',
			'.jpg': 'image/jpeg',
			'.jpeg': 'image/jpeg',
			'.webp': 'image/webp',
			'.gif': 'image/gif',
			'.pdf': 'application/pdf',
			'.md': 'text/markdown',
			'.txt': 'text/plain'
		},
		maxBytes: 5 * 1024 * 1024,
		maxBytesLabel: '5MB',
		maxFiles: 6
	},
	/**
	 * The account avatar. No model involved: the file is downscaled and shown.
	 *
	 * The list has to hold for the *uploaded* bytes, not the picked ones.
	 * `downscaleImage` re-encodes to WebP only when that is smaller and hands
	 * the original back on any decode failure, so a type that is not listed
	 * here can still arrive at the server unchanged.
	 */
	profileImage: {
		extensions: {
			'.png': 'image/png',
			'.jpg': 'image/jpeg',
			'.jpeg': 'image/jpeg',
			'.webp': 'image/webp',
			'.gif': 'image/gif'
		},
		sourceMimePrefixes: ['image/'],
		maxBytes: 2 * 1024 * 1024,
		maxBytesLabel: '2MB',
		maxFiles: 1
	}
} as const satisfies Record<string, UploadProfile>;

export type UploadProfileName = keyof typeof UPLOAD_PROFILES;

/** Mime types a profile accepts, deduplicated. */
export function allowedMimeTypes(profile: UploadProfile): string[] {
	return Array.from(new Set(Object.values(profile.extensions)));
}

/**
 * Value for a file input's `accept` attribute.
 *
 * Offers the input families where the surface has a transcoder, so the picker
 * is not narrower than what the surface can actually take.
 */
export function acceptAttribute(profile: UploadProfile): string {
	const families = (profile.sourceMimePrefixes ?? []).map((prefix) => `${prefix}*`);
	if (families.length) return families.join(',');
	return Object.keys(profile.extensions).join(',');
}

/**
 * Whether a profile accepts this mime type for STORAGE, ignoring any charset
 * parameter. This is the answer the server enforces.
 */
export function acceptsMimeType(profile: UploadProfile, mimeType: string): boolean {
	const essence = mimeType.split(';')[0]!.trim().toLowerCase();
	return allowedMimeTypes(profile).includes(essence);
}

/**
 * Whether a user may pick this file, which on a transcoding surface is wider
 * than what may be stored. Falls back to the storage answer where no input
 * family is declared, so a surface without a transcoder behaves as before.
 *
 * A surface that uses this must re-check the transcoder's OUTPUT with
 * acceptsMimeType: the avatar transcoder is not total (it passes GIFs through,
 * keeps the original when the re-encode is larger, and falls back on a decode
 * failure), so picking is not a promise that the result is storable.
 */
export function acceptsSource(profile: UploadProfile, mimeType: string): boolean {
	const essence = mimeType.split(';')[0]!.trim().toLowerCase();
	const families = profile.sourceMimePrefixes ?? [];
	if (!families.length) return acceptsMimeType(profile, essence);
	return families.some((prefix) => essence.startsWith(prefix));
}
