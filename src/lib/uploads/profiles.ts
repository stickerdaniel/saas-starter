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
	/** Extension to mime type. The source of truth both derivations read. */
	extensions: Readonly<Record<string, string>>;
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

/** Value for a file input's `accept` attribute. */
export function acceptAttribute(profile: UploadProfile): string {
	return Object.keys(profile.extensions).join(',');
}

/** Whether a profile accepts this mime type, ignoring any charset parameter. */
export function acceptsMimeType(profile: UploadProfile, mimeType: string): boolean {
	const essence = mimeType.split(';')[0]!.trim().toLowerCase();
	return allowedMimeTypes(profile).includes(essence);
}
