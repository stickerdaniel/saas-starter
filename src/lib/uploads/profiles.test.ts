import { describe, expect, it } from 'vitest';
import {
	acceptAttribute,
	acceptsMimeType,
	acceptsSource,
	allowedMimeTypes,
	UPLOAD_PROFILES,
	type UploadProfile,
	type UploadProfileName
} from './profiles';
import { canConsume, PROFILE_CONSUMERS, type Consumer } from './consumers';
import { mediaCategoryOf, MODEL_INPUT_MODALITIES } from './model-capabilities';

// Widened to UploadProfile so the loops can read optional fields like
// sourceMimePrefixes, which the const assertion narrows away per profile.
const PROFILES = Object.entries(UPLOAD_PROFILES) as Array<[UploadProfileName, UploadProfile]>;

describe('mediaCategoryOf', () => {
	it('maps top-level types to modality names', () => {
		expect(mediaCategoryOf('image/png')).toBe('image');
		expect(mediaCategoryOf('text/markdown')).toBe('text');
		expect(mediaCategoryOf('audio/mpeg')).toBe('audio');
		expect(mediaCategoryOf('video/mp4')).toBe('video');
	});

	it('treats documents as the file modality', () => {
		expect(mediaCategoryOf('application/pdf')).toBe('file');
		expect(mediaCategoryOf('application/zip')).toBe('file');
	});

	it('ignores charset parameters and casing', () => {
		expect(mediaCategoryOf('TEXT/PLAIN; charset=utf-8')).toBe('text');
	});
});

describe('profile derivations', () => {
	it.each(PROFILES)('%s derives accept and mime list from one source', (_name, profile) => {
		const mimes = allowedMimeTypes(profile);
		const entries = Object.entries(profile.extensions);

		// A transcoding surface offers its input families instead of extensions,
		// because what may be picked is wider than what may be stored.
		const expectedAccept = profile.sourceMimePrefixes?.length
			? profile.sourceMimePrefixes.map((prefix) => `${prefix}*`)
			: entries.map(([ext]) => ext);
		expect(acceptAttribute(profile).split(',')).toEqual(expectedAccept);
		expect(mimes.length).toBeGreaterThan(0);
		// Every extension resolves to a listed mime type, so the picker and the
		// server validator cannot disagree about a format.
		for (const [, mime] of entries) {
			expect(mimes).toContain(mime);
		}
	});

	it('matches mime types regardless of charset suffix', () => {
		const profile = UPLOAD_PROFILES.chatAttachment;
		expect(acceptsMimeType(profile, 'text/plain; charset=utf-8')).toBe(true);
		expect(acceptsMimeType(profile, 'application/zip')).toBe(false);
	});
});

describe('picking versus storing', () => {
	// The regression this exists for: checking the PICKED file against the
	// stored list rejected HEIC, which is the iOS camera default, before
	// downscaleImage could turn it into the WebP the server does accept.
	it('lets the avatar accept an input it will never store', () => {
		const profile = UPLOAD_PROFILES.profileImage;
		expect(acceptsSource(profile, 'image/heic')).toBe(true);
		expect(acceptsMimeType(profile, 'image/heic')).toBe(false);
	});

	it('offers the input family to the picker, not the stored extensions', () => {
		expect(acceptAttribute(UPLOAD_PROFILES.profileImage)).toBe('image/*');
	});

	// Everything the transcoder can hand back unchanged has to fail the storage
	// check, or the drift this whole structure closes would reopen: GIF is passed
	// through by design, and SVG survives whenever the decode fails.
	it('still refuses to store what the transcoder passes through', () => {
		const profile = UPLOAD_PROFILES.profileImage;
		expect(acceptsSource(profile, 'image/svg+xml')).toBe(true);
		expect(acceptsMimeType(profile, 'image/svg+xml')).toBe(false);
	});

	it('treats picking and storing alike where no transcoder sits in between', () => {
		const profile: UploadProfile = UPLOAD_PROFILES.chatAttachment;
		expect(profile.sourceMimePrefixes).toBeUndefined();
		for (const mime of [...allowedMimeTypes(profile), 'application/zip', 'image/heic']) {
			expect(acceptsSource(profile, mime)).toBe(acceptsMimeType(profile, mime));
		}
	});
});

describe('consumer capability', () => {
	// The guard this file exists for: a surface must not accept media its
	// consumer cannot read. Changing CHAT_MODEL_ID to a model without image
	// input, or adding a format to a profile, fails here rather than in
	// production — which is exactly how the silent PDF/OCR path (#781) got in.
	it.each(PROFILES)('%s only accepts what every consumer handles', (name, profile) => {
		for (const consumer of PROFILE_CONSUMERS[name]) {
			for (const mimeType of allowedMimeTypes(profile)) {
				const verdict = canConsume(consumer, mimeType);
				expect(
					verdict,
					`profile "${name}" accepts ${mimeType}, but consumer "${describeConsumer(
						consumer
					)}" reports "${verdict}". Either drop the type, declare an adapter that converts it, or update the capability entry.`
				).not.toBe('unsupported');
				expect(
					verdict,
					`profile "${name}" targets model "${describeConsumer(consumer)}" which has no entry in MODEL_INPUT_MODALITIES. Add its input modalities (see https://openrouter.ai/api/v1/models).`
				).not.toBe('unknown-model');
			}
		}
	});

	it('rejects a type the consumer cannot read', () => {
		const consumer: Consumer = { kind: 'pipeline', id: 'test', handles: ['image'] };
		expect(canConsume(consumer, 'application/pdf')).toBe('unsupported');
	});

	it('accepts an adapted type only for the exact mime type declared', () => {
		const consumer: Consumer = {
			kind: 'model',
			modelId: 'google/gemma-4-26b-a4b-it',
			adapters: { 'application/pdf': 'openrouter:file-parser:cloudflare-ai' }
		};
		expect(canConsume(consumer, 'application/pdf')).toBe('adapter');
		// Same media category, no adapter of its own: an adapter must not widen
		// to every document type.
		expect(canConsume(consumer, 'application/zip')).toBe('unsupported');
	});

	it('reports an unknown model instead of assuming it is capable', () => {
		const consumer: Consumer = { kind: 'model', modelId: 'vendor/not-configured' };
		expect(canConsume(consumer, 'image/png')).toBe('unknown-model');
	});
});

function describeConsumer(consumer: Consumer): string {
	return consumer.kind === 'model' ? consumer.modelId : consumer.id;
}

describe('capability map', () => {
	it('uses the OpenRouter modality vocabulary', () => {
		const allowed = new Set(['text', 'image', 'audio', 'video', 'file']);
		for (const [modelId, modalities] of Object.entries(MODEL_INPUT_MODALITIES)) {
			expect(modalities.length, `${modelId} has no modalities`).toBeGreaterThan(0);
			for (const modality of modalities) {
				expect(allowed, `${modelId} declares unknown modality "${modality}"`).toContain(modality);
			}
		}
	});
});
