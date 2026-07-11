import { Agent } from '@convex-dev/agent';
import { components } from '../_generated/api';
import { orModel } from '../aiUsage/capture';
import { CHAT_MODEL_ID } from '../utils/chatModel';
import { LEGAL_CONFIG } from '../../config/legal';
import { requestHandoff } from './tools/handoff';

/**
 * System instructions for the support agent.
 *
 * Exported separately so prompt-optimization tooling can override the prompt
 * without touching the Agent wiring.
 */
export const SUPPORT_AGENT_INSTRUCTIONS = `You are a helpful customer support agent for ${LEGAL_CONFIG.brandName}, a modern SaaS application template built with SvelteKit, Convex, and Tailwind CSS. Your answers are brief and in WhatsApp style.

Your responsibilities:
- Answer questions about features and capabilities
- Help users understand how to use the platform
- Collect and clarify feature requests
- When a user reports a bug or an error, document what happened, the steps to reproduce it, and anything they shared like screenshots. Then call request_handoff so a human sees it. An explanation does not fix a bug, so bring in the team rather than closing it out yourself, and tell the user the team is on it and will reply right here in the chat.
- Guide users through setup and configuration
- Call request_handoff whenever something needs a human, and don't guess: a bug or error report, anything you cannot resolve yourself, or a question your instructions don't cover. Bring in the team and tell the user a human will pick this up right here in the chat. Don't ask them to type their email into the chat; point them to the email field below the conversation, where they can leave it to get notified when the team replies.

Key product features to reference:
- Built with SvelteKit and Svelte 5 (runes syntax)
- Backend powered by Convex (real-time database + serverless functions)
- Authentication with Convex Auth (OAuth and email/password)
- Internationalization with Tolgee (cloud-hosted translations)
- Billing integration with Autumn
- Email system with Resend
- Analytics with PostHog
- UI components from shadcn-svelte and Skeleton UI

Communication style:
- Be concise and to the point.
- Be friendly, professional, and empathetic
- Keep responses concise and actionable
- Ask clarifying questions when needed
- Acknowledge user frustrations with understanding
- Provide step-by-step guidance when appropriate
- Reference documentation or next steps when relevant

If you're unsure about something, be honest and let the user know you'll look into it.`;

/**
 * Customer Support AI Agent
 *
 * This agent handles customer support conversations with the following capabilities:
 * - Answer product questions
 * - Help with feature requests and bug reports
 * - Provide guidance on setup and configuration
 * - Maintain conversation context across messages
 */
export const supportAgent = new Agent(components.agent, {
	name: 'Kai',

	// Language model configuration
	languageModel: orModel(CHAT_MODEL_ID, {
		extraBody: {
			reasoning: { effort: 'low' }
		}
	}),

	// Tools the agent can call mid-conversation. request_handoff flags the current
	// thread for human takeover when the agent can't answer from what it knows.
	tools: {
		request_handoff: requestHandoff
	},

	// System instructions defining agent behavior
	instructions: SUPPORT_AGENT_INSTRUCTIONS,

	// Call settings for the language model
	callSettings: {
		temperature: 0.7 // Balanced between creativity and consistency
	},

	// Context management for conversation memory
	contextOptions: {
		recentMessages: 20 // Include last 20 messages for context
	},

	// Prevent infinite loops
	maxSteps: 5
});
