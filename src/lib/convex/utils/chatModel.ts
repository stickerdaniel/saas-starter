/**
 * Single source of truth for the OpenRouter chat model used by both the AI chat
 * assistant (`aiChat/agent.ts`) and the support agent Kai (`support/agent.ts`).
 *
 * Model migrations (e.g. Gemma 4 → 5) are now a one-line change here.
 *
 * Reasoning configuration stays at each agent's call site — the two agents
 * intentionally diverge (medium for Pro AI chat, 'low' for the public anonymous
 * support surface) and that divergence should remain visible at the agent
 * definition rather than hidden behind a default.
 */
export const CHAT_MODEL_ID = 'google/gemma-4-26b-a4b-it';
