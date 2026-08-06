/**
 * What each upload surface accepts, declared once.
 *
 * Every client and server constant about accepted types and size caps derives
 * from a profile here, so the picker, the drop/paste gate and the server
 * validator cannot drift apart. They used to be three independent literals
 * (see #782), and the profile-image surface had already drifted.
 *
 * A profile also names its consumer, which is what makes the allowlist
 * checkable: `profiles.test.ts` asserts that a surface only accepts media its
 * consumer can handle. The consumer is not always a model — an avatar is only
 * ever rendered — so it is modelled as either a model or a plain pipeline.
 *
 * Imported by both browser and Convex code, so this module stays free of
 * Svelte, browser APIs and `convex/values`.
 */

import { AI_CHAT_MODEL_ID, SUPPORT_MODEL_ID } from '../convex/utils/chatModel';
import { mediaCategoryOf, MODEL_INPUT_MODALITIES } from './model-capabilities';

/**
 * Who ends up processing the bytes.
 *
 * `adapters` records a media type the model itself cannot read but something
 * in the request path converts on its behalf. The value is the reason, not a
 * boolean, so the exception has to be spelled out to be granted.
 */
export type Consumer =
	| { kind: 'model'; modelId: string; adapters?: Readonly<Record<string, string>> }
	| { kind: 'pipeline'; id: string; handles: readonly string[] };

export type UploadProfile = {
	/** Extension to mime type. The source of truth both derivations read. */
	extensions: Readonly<Record<string, string>>;
	maxBytes: number;
	maxBytesLabel: string;
	maxFiles: number;
	/**
	 * Everything that ends up reading these files. A surface can feed more than
	 * one: chat attachments reach both the assistant and the support agent, and
	 * `chatModel.ts` keeps those model ids apart precisely so they can diverge.
	 * The profile is only valid if *every* consumer can handle what it accepts.
	 */
	consumers: readonly Consumer[];
};

/**
 * PDFs reach the chat models through OpenRouter's file parser, not through the
 * models themselves, which report no `file` modality. The engine is pinned at
 * the call site in `aiUsage/capture.ts`; leaving it unset bills Mistral OCR per
 * page (#781).
 */
const PDF_VIA_OPENROUTER = { 'application/pdf': 'openrouter:file-parser:cloudflare-ai' } as const;

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
		maxFiles: 6,
		consumers: [
			{ kind: 'model', modelId: AI_CHAT_MODEL_ID, adapters: PDF_VIA_OPENROUTER },
			{ kind: 'model', modelId: SUPPORT_MODEL_ID, adapters: PDF_VIA_OPENROUTER }
		]
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
		maxFiles: 1,
		consumers: [{ kind: 'pipeline', id: 'avatar-render', handles: ['image'] }]
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

/**
 * Whether a consumer can take one specific mime type.
 *
 * Resolved per mime type rather than per category on purpose: an adapter is
 * declared for `application/pdf`, and widening that to the whole `file`
 * category would silently also permit `.docx` and every other document type.
 *
 * `unknown-model` is its own answer so a model configured without a capability
 * entry fails the test instead of quietly passing it.
 */
export type ConsumeVerdict = 'native' | 'adapter' | 'unsupported' | 'unknown-model';

export function canConsume(consumer: Consumer, mimeType: string): ConsumeVerdict {
	const essence = mimeType.split(';')[0]!.trim().toLowerCase();
	const category = mediaCategoryOf(essence);

	if (consumer.kind === 'pipeline') {
		return consumer.handles.includes(category) ? 'native' : 'unsupported';
	}

	const modalities = MODEL_INPUT_MODALITIES[consumer.modelId];
	if (!modalities) return 'unknown-model';
	if (modalities.includes(category)) return 'native';
	return consumer.adapters?.[essence] ? 'adapter' : 'unsupported';
}
