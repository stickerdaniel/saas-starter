import { createTool } from '@convex-dev/agent';
import { z } from 'zod';
import { internal } from '../../_generated/api';

/**
 * Hand the current support conversation to a human on the team.
 *
 * Built with @convex-dev/agent's createTool (not the plain ai `tool`) because
 * the execute handler receives the agent's ToolCtx: the Convex action ctx plus
 * the userId and threadId that streamText was called with. support/messages.ts
 * runs supportAgent.streamText(ctx, { threadId, userId }, ...), and the agent
 * injects that threadId into every tool call, so the tool knows which thread to
 * flip without the model having to pass an id.
 *
 * The flag flip itself lives in an internal mutation (support/handoff.ts's
 * internalSetHandoff) that mirrors the widget's updateThreadHandoff: no email is
 * collected, the same thread stays put, and the team takes it over in the widget.
 */
export const requestHandoff = createTool({
	description:
		'Hand this conversation to a human on the team. Call it whenever something needs a human instead of guessing or only explaining: a bug or error the user reported (an explanation does not fix a bug), a question you cannot resolve yourself, or anything not covered by your instructions. It flags this same chat so the team takes over and replies right here. It does not ask the user for an email; the widget shows an email field below the chat where they can leave one to get notified.',
	inputSchema: z.object({
		reason: z
			.string()
			.optional()
			.describe(
				'One-line summary of what the user asked and why it needs a human; for a bug, what broke and how to reproduce it. Always fill this in. For team context and logging only; not shown to the user.'
			)
	}),
	execute: async (ctx, { reason }) => {
		// threadId is injected by the agent into the tool ctx (streamText builds
		// toolCtx = { ...ctx, threadId, userId } and wraps every tool with it).
		// It is always present on the real streamText path; guard defensively.
		if (!ctx.threadId) {
			return "I couldn't reach the team from here. Please send your message again and a human will pick it up.";
		}

		if (reason) {
			console.log(`[requestHandoff] thread=${ctx.threadId} reason=${reason}`);
		}

		await ctx.runMutation(internal.support.handoff.internalSetHandoff, {
			threadId: ctx.threadId
		});

		return 'The team has been brought in and will reply right here in this chat. Let the user know, and tell them they can leave their email in the field below the chat to get notified when the team replies.';
	}
});
