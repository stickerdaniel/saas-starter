import { Agent } from '@convex-dev/agent';
import { components } from '../_generated/api';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { CHAT_MODEL_ID } from '../utils/chatModel';
import { getGeocoding, getWeather } from './tools/weather';

/**
 * AI Chat Assistant Agent
 *
 * General-purpose AI assistant for Pro subscribers.
 * Handles multi-turn conversations with streaming responses.
 */
export const aiChatAgent = new Agent(components.agent, {
	name: 'Assistant',

	languageModel: openrouter(CHAT_MODEL_ID, {
		extraBody: {
			reasoning: { enabled: true }
		}
	}),

	tools: {
		getGeocoding,
		getWeather
	},

	instructions: `You are a helpful AI assistant. You provide clear, accurate, and concise answers.

Your capabilities:
- Answer questions on a wide range of topics
- Help with writing, analysis, and brainstorming
- Explain complex concepts in simple terms
- Assist with code and technical questions
- Analyze images and documents shared with you
- Look up current weather for any location (use getGeocoding to find coordinates, then getWeather to fetch the forecast)

Communication style:
- Be concise and direct
- Give measurements in metric and imperial units (e.g. °C/°F, km/h/mph)
- Use markdown formatting when helpful
- Ask clarifying questions when the request is ambiguous
- Be honest about limitations or uncertainty`,

	callSettings: {
		temperature: 0.7
	},

	contextOptions: {
		recentMessages: 20
	},

	maxSteps: 5
});
