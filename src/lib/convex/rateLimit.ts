import { RateLimiter, MINUTE, HOUR } from '@convex-dev/rate-limiter';
import { components } from './_generated/api';

/**
 * Rate limiter for top-level app mutations (community chat, profile image).
 *
 * Per-user limits keyed by the authenticated user ID.
 */
export const appRateLimiter = new RateLimiter(components.rateLimiter, {
	// Per-user community chat message rate
	// Token bucket: 5-message burst, then 1 every 12s sustained
	communityMessage: {
		kind: 'token bucket',
		rate: 5,
		period: MINUTE,
		capacity: 5
	},

	// Per-user profile image upload-URL minting
	// Token bucket: 10-call burst, sustained 10/hour
	profileImageUpload: {
		kind: 'token bucket',
		rate: 10,
		period: HOUR,
		capacity: 10
	},

	// Per-user profile image finalize/update
	// Separate bucket from the upload-URL step (both are directly reachable)
	profileImageUpdate: {
		kind: 'token bucket',
		rate: 10,
		period: HOUR,
		capacity: 10
	}
});
