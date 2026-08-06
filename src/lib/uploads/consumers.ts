/**
 * What reads the files each upload surface accepts.
 *
 * Kept apart from `profiles.ts` because the profiles are imported by browser
 * code: putting model ids next to the accepted types would ship them in the
 * client bundle for no reason.
 *
 * Nothing in production reads this map — it exists so `profiles.test.ts` can
 * assert that a surface only accepts media its consumers can handle. That is
 * the guard the silent PDF/OCR path (#781) got past: nothing forced anyone to
 * state that the chat models cannot read a PDF on their own.
 */

import { AI_CHAT_MODEL_ID, SUPPORT_MODEL_ID } from '../convex/utils/chatModel';
import { mediaCategoryOf, MODEL_INPUT_MODALITIES } from './model-capabilities';
import type { UploadProfileName } from './profiles';

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

/**
 * PDFs reach the chat models through OpenRouter's file parser, not through the
 * models themselves, which report no `file` modality. The engine is pinned at
 * the call site in `aiUsage/capture.ts`; leaving it unset bills Mistral OCR per
 * page (#781).
 */
const PDF_VIA_OPENROUTER = { 'application/pdf': 'openrouter:file-parser:cloudflare-ai' } as const;

/**
 * Every consumer a surface feeds. A profile is only valid if all of them can
 * handle everything it accepts: chat attachments reach both the assistant and
 * the support agent, and `chatModel.ts` keeps those model ids apart precisely
 * so they can diverge.
 */
export const PROFILE_CONSUMERS: Readonly<Record<UploadProfileName, readonly Consumer[]>> = {
	chatAttachment: [
		{ kind: 'model', modelId: AI_CHAT_MODEL_ID, adapters: PDF_VIA_OPENROUTER },
		{ kind: 'model', modelId: SUPPORT_MODEL_ID, adapters: PDF_VIA_OPENROUTER }
	],
	profileImage: [{ kind: 'pipeline', id: 'avatar-render', handles: ['image'] }]
};

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
