import { internalAction } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { generateText } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { CHAT_MODEL_ID } from '../utils/chatModel';
import { getAutumnSdk } from '../autumn';

// Clamp the stored title; the sidebar span also CSS-truncates for display.
const MAX_TITLE_LENGTH = 60;
// Only the opening of the first message matters for a title; cap tokens sent.
const MAX_PROMPT_CHARS = 500;

/**
 * Generate a short, descriptive thread title from the first user message.
 *
 * Scheduled (fire-and-forget) from `sendMessage` on the first message of a
 * thread. Runs a single non-reasoning LLM call (no reasoning extraBody, unlike
 * the chat agent) and writes the result to `aiChatThreads.title` via
 * `setThreadTitleIfEmpty` (first-write-wins, so a late/duplicate run can never
 * overwrite an existing title). The sidebar prefers this title over the
 * last-message preview. On any failure we keep no title and the UI falls back
 * gracefully, so errors are swallowed (logged only).
 *
 * Gated by the same Autumn `ai_chat_messages` allowance as the AI response, so a
 * client bypassing the frontend billing check can't trigger unmetered title LLM
 * calls. We only check (never track) — the response path tracks the usage unit.
 */
export const generateThreadTitle = internalAction({
	args: {
		threadId: v.string(),
		prompt: v.string(),
		userId: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const source = args.prompt.trim().slice(0, MAX_PROMPT_CHARS);
		if (!source) return null;

		// Billing gate (check only): skip when the user is out of AI chat
		// allowance, matching createAIResponse. Autumn fails open on 5xx/network.
		if (args.userId) {
			const sdk = await getAutumnSdk();
			const checkResult = await sdk.check({
				customer_id: args.userId,
				feature_id: 'ai_chat_messages'
			});
			if (checkResult.data && !checkResult.data.allowed) return null;
		}

		let raw: string;
		try {
			const { text } = await generateText({
				model: openrouter(CHAT_MODEL_ID),
				temperature: 0.3,
				prompt: `Summarize the following user message into a short, descriptive conversation title of 3 to 6 words. Use title case. Do not use quotation marks or trailing punctuation. Respond with the title only, nothing else.\n\nMessage:\n${source}`
			});
			raw = text;
		} catch (err) {
			console.warn('[generateThreadTitle] LLM call failed', err);
			return null;
		}

		// Sanitize: first line only, strip wrapping quotes/backticks, clamp length.
		let title = (raw.split('\n')[0] ?? '')
			.trim()
			.replace(/^["'`]+|["'`]+$/g, '')
			.trim();
		if (!title) return null;
		if (title.length > MAX_TITLE_LENGTH) {
			title = title.slice(0, MAX_TITLE_LENGTH).trim();
		}

		await ctx.runMutation(internal.aiChat.threads.setThreadTitleIfEmpty, {
			threadId: args.threadId,
			title
		});

		return null;
	}
});
