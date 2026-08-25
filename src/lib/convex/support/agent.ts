import { Agent } from '@convex-dev/agent';
import { components } from '../_generated/api';
import { orModel } from '../aiUsage/capture';
import { SUPPORT_MODEL_ID } from '../utils/chatModel';
import { LEGAL_CONFIG } from '../../config/legal';
import { renderAuthoredTemplate } from '../../content/authored-template';
import { SUPPORT_AGENT_INSTRUCTIONS_TEMPLATE } from './instructions.generated';
import { requestHandoff } from './tools/handoff';

/**
 * System instructions for the support agent — the seed prompt.
 *
 * This is the fallback served when no stored override is active. At runtime
 * support/messages.ts reads support/promptStore.getActive and, when a row is
 * active, passes it as the per-turn system override in place of this text.
 * Prompt-optimization tooling writes its result through that store, so it can
 * ship a new prompt without editing this file.
 */
export const SUPPORT_AGENT_INSTRUCTIONS = renderAuthoredTemplate(
	'Support agent instructions',
	SUPPORT_AGENT_INSTRUCTIONS_TEMPLATE,
	{ BRAND_NAME: LEGAL_CONFIG.brandName }
);

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
	languageModel: orModel(SUPPORT_MODEL_ID, {
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
