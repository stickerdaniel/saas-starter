import { RateLimiter, MINUTE } from '@convex-dev/rate-limiter';
import { components } from '../_generated/api';

/**
 * Rate limiter for customer support agent
 *
 * Prevents abuse of the AI support agent by limiting:
 * - Per-user message frequency (authenticated vs anonymous)
 * - Global LLM calls for cost protection
 *
 * Rate limit keying strategy:
 * - Authenticated users: keyed by server-verified user ID
 * - Anonymous users: keyed by anonymous user ID (fallback: thread ID)
 */
export const supportRateLimiter = new RateLimiter(components.rateLimiter, {
	// Authenticated user message limit
	// Token bucket: 5-message burst for natural conversation, then 1 every 12s sustained
	supportMessage: {
		kind: 'token bucket',
		rate: 5,
		period: MINUTE,
		capacity: 5
	},

	// Anonymous user message limit (stricter to prevent abuse)
	// Token bucket: 3-message burst, then 1 every 20s sustained
	supportMessageAnon: {
		kind: 'token bucket',
		rate: 3,
		period: MINUTE,
		capacity: 3
	},

	// Global LLM call limit (cost protection)
	// Soft-fails when exceeded - saves explanatory message for user
	// Sharded for high throughput across all users
	globalLLM: {
		kind: 'fixed window',
		rate: 500,
		period: MINUTE,
		shards: 5
	}
});
