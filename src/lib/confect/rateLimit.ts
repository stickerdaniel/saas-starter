import { RateLimiter, MINUTE, HOUR } from '@convex-dev/rate-limiter';
import { components } from '../convex/_generated/api';

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

	// Per-user profile image uploads
	// Token bucket: 10-upload burst, sustained 10/hour
	profileImageUpload: {
		kind: 'token bucket',
		rate: 10,
		period: HOUR,
		capacity: 10
	},

	// Per-user first-password setup.
	// Deliberately tight: setting a first password is a once-per-account action,
	// and the call hashes the candidate with scrypt before it can reject it, so an
	// unthrottled caller turns a public mutation into a CPU sink.
	setPassword: {
		kind: 'token bucket',
		rate: 5,
		period: HOUR,
		capacity: 5
	}
});
