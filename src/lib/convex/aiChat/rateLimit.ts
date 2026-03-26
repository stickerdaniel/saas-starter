import { RateLimiter, MINUTE, HOUR } from '@convex-dev/rate-limiter';
import { components } from '../_generated/api';

/**
 * Rate limiter for AI Chat (Pro-only feature)
 *
 * Per-user limits only. No global LLM cap since this is a paid feature
 * and a global cap would limit paying users during high-traffic periods.
 */
export const aiChatRateLimiter = new RateLimiter(components.rateLimiter, {
	// Per-user message rate
	// Token bucket: 5-message burst for natural conversation, then 1 every 12s sustained
	aiChatMessage: {
		kind: 'token bucket',
		rate: 5,
		period: MINUTE,
		capacity: 5
	},

	// Per-user file upload rate
	// Token bucket: 10-file burst for batch uploads, sustained 10/hour
	aiChatFileUpload: {
		kind: 'token bucket',
		rate: 10,
		period: HOUR,
		capacity: 10
	}
});
