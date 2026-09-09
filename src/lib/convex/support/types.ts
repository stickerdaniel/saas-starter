import { ConvexError } from 'convex/values';

/**
 * Rate limit error data structure
 *
 * Used for consistent error handling between backend and frontend.
 */
export type RateLimitErrorData = {
	code: 'RATE_LIMITED';
	retryAfter: number;
};

/**
 * Create a rate limit ConvexError with consistent structure
 *
 * @param retryAfter - Time in milliseconds until the rate limit resets
 */
export function createRateLimitError(retryAfter: number): ConvexError<RateLimitErrorData> {
	return new ConvexError({
		code: 'RATE_LIMITED' as const,
		retryAfter
	});
}
