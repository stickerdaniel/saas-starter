import { v } from 'convex/values';

/**
 * Canonical declaration of the LLM operations we meter.
 *
 * Used by both schema.ts (the `aiUsage.feature` column) and the `insert`
 * mutation's argument validator, so adding a feature here updates both.
 */
export const aiUsageFeatureValidator = v.union(
	v.literal('ai_chat'),
	v.literal('ai_chat_title'),
	v.literal('support_chat')
);
