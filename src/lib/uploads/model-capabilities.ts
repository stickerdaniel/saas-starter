/**
 * What the models this repo configures can actually take as input.
 *
 * Deliberately covers only the models we run, not the provider catalogue. The
 * AI SDK makes the same call for a different reason: `LanguageModelV4` carries
 * no media-capability field at all (only `supportedUrls`, which answers whether
 * the model fetches a URL itself), and the capability matrix lives in its docs.
 * A table spanning every model would be stale the week after it was written; a
 * table spanning the one model we configure is small enough to keep honest, and
 * `profiles.test.ts` fails the build if a model is configured without an entry.
 *
 * The vocabulary matches OpenRouter's `architecture.input_modalities`, so the
 * entries can be checked against https://openrouter.ai/api/v1/models when a
 * model changes.
 */

/** Input modality vocabulary, mirroring OpenRouter's `input_modalities`. */
export type MediaCategory = 'text' | 'image' | 'audio' | 'video' | 'file';

/**
 * Coarse category of a mime type, matching how providers describe modalities.
 *
 * Anything that is not audio/image/video/text is a document as far as a model
 * is concerned, which is the `file` modality: PDFs, office formats, archives.
 */
export function mediaCategoryOf(mimeType: string): MediaCategory {
	const essence = mimeType.split(';')[0]!.trim().toLowerCase();
	const topLevel = essence.split('/')[0];
	if (topLevel === 'text') return 'text';
	if (topLevel === 'image') return 'image';
	if (topLevel === 'audio') return 'audio';
	if (topLevel === 'video') return 'video';
	return 'file';
}

/**
 * Verified against OpenRouter's model API. Update alongside the model ids in
 * `convex/utils/chatModel.ts`, which are kept separate so they can diverge.
 *
 * Note that `google/gemma-4-26b-a4b-it` has no `file` modality, which is why
 * the chat profile has to declare an adapter for PDFs rather than assume the
 * model reads them (see #781).
 */
export const MODEL_INPUT_MODALITIES: Readonly<Record<string, readonly MediaCategory[]>> = {
	'google/gemma-4-26b-a4b-it': ['text', 'image', 'video']
};
