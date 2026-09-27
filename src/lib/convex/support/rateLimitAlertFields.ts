import { v, type Infer } from 'convex/values';

/**
 * The anonymous support rate limits that share one global bucket
 * (ANONYMOUS_GLOBAL_RATE_LIMIT_KEY in rateLimit.ts), so saturating them locks
 * out every signed-out visitor at once. supportMessageAnon is keyed per
 * anonymous ID and has no shared bucket to watch.
 *
 * Used by schema.ts, the sampling cron, and the alert email mutation.
 */
export const vAnonymousRateLimitBucket = v.union(
	v.literal('supportThreadCreateAnon'),
	v.literal('supportFileUploadAnon'),
	v.literal('supportFilePreviewAnon')
);

export type AnonymousRateLimitBucket = Infer<typeof vAnonymousRateLimitBucket>;
