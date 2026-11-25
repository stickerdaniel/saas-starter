import { FunctionImpl, GroupImpl } from '@confect/server';
import { generateText } from 'ai';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { MutationRunner } from '../_generated/services';
import { captureDirect, orModel } from '../aiUsage/capture';
import { recordAiUsage } from '../aiUsage/record.impl';
import { getAutumnSdk } from '../autumn';
import {
	CapabilityConfigurationError,
	requireAiConfiguration,
	requireBillingConfiguration
} from '../env';
import { TITLE_MODEL_ID } from '../utils/chatModel';
import titles from './titles.spec';

const MAX_TITLE_LENGTH = 60;
const MAX_PROMPT_CHARS = 500;

const configured = (check: () => void) =>
	Effect.sync(() => {
		try {
			check();
			return true;
		} catch (error) {
			if (error instanceof CapabilityConfigurationError) return false;
			throw error;
		}
	});

async function titleAllowed(userId: string) {
	try {
		const sdk = await getAutumnSdk();
		const checkResult = await sdk.check({ customer_id: userId, feature_id: 'ai_chat_messages' });
		return !(checkResult.data && !checkResult.data.allowed);
	} catch (error) {
		if (error instanceof CapabilityConfigurationError) return false;
		throw error;
	}
}

async function draftTitle(source: string) {
	try {
		const { text, usage, providerMetadata } = await generateText({
			model: orModel(TITLE_MODEL_ID),
			temperature: 0.3,
			prompt: `Summarize the following user message into a short, descriptive conversation title of 3 to 6 words. Use title case. Do not use quotation marks or trailing punctuation. Respond with the title only, nothing else.\n\nMessage:\n${source}`
		});
		return { text, model: captureDirect(usage, providerMetadata, TITLE_MODEL_ID) };
	} catch {
		console.warn({ code: 'ai_chat_title_failed' });
		return null;
	}
}

const cleanTitle = (raw: string) => {
	const title = (raw.split('\n')[0] ?? '')
		.trim()
		.replace(/^["'`]+|["'`]+$/g, '')
		.trim();
	return title.length > MAX_TITLE_LENGTH ? title.slice(0, MAX_TITLE_LENGTH).trim() : title;
};

export default GroupImpl.make(databaseSchema, titles).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, titles, 'generateThreadTitle', (args) =>
			Effect.gen(function* () {
				const source = args.prompt.trim().slice(0, MAX_PROMPT_CHARS);
				if (!source) return null;
				const ready = yield* configured(() => {
					requireBillingConfiguration();
					requireAiConfiguration();
				});
				if (!ready) return null;
				const { userId } = args;
				if (userId && !(yield* Effect.promise(() => titleAllowed(userId)))) return null;
				if (!(yield* configured(requireAiConfiguration))) return null;
				const draft = yield* Effect.promise(() => draftTitle(source));
				if (draft === null) return null;
				yield* recordAiUsage({ feature: 'ai_chat_title', userId, models: [draft.model] });
				const title = cleanTitle(draft.text);
				if (!title) return null;
				yield* (yield* MutationRunner)
					.runMutation(refs.internal.aiChat.threads.setThreadTitleIfEmpty, {
						threadId: args.threadId,
						title
					})
					.pipe(Effect.orDie);
				return null;
			})
		)
	]),
	GroupImpl.finalize
);
