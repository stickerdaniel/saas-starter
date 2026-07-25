/**
 * OpenRouter model ids for the three chat-shaped workloads, kept apart on
 * purpose: they have genuinely different requirements, and a shared constant
 * silently drags all three along whenever one of them is upgraded.
 *
 * Reasoning configuration stays at each call site — the agents intentionally
 * diverge (medium for the Pro AI chat, 'low' for the public anonymous support
 * surface) and that divergence should remain visible at the agent definition
 * rather than hidden behind a default.
 */

/** The AI chat assistant (`aiChat/agent.ts`): open-ended, tool-using turns. */
export const AI_CHAT_MODEL_ID = 'google/gemma-4-26b-a4b-it';

/**
 * The support agent Kai (`support/agent.ts`): answers from a fixed prompt with
 * one escalation tool, on a public anonymous surface. It talks to prospects
 * about the product, so answer quality matters more than tool choreography —
 * upgrade it on support-eval evidence, not because the assistant moved.
 */
export const SUPPORT_MODEL_ID = 'google/gemma-4-26b-a4b-it';

/**
 * Thread-title generation (`aiChat/titles.ts`): a few words from the opening
 * message, no reasoning, no tools. The cheapest capable model wins here; it has
 * no reason to track whichever model the assistant runs.
 */
export const TITLE_MODEL_ID = 'google/gemma-4-26b-a4b-it';
