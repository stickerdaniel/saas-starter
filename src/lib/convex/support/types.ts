import { ConvexError } from 'convex/values';

/**
 * Rate limit error data structure
 *
 * Used for consistent error handling between backend and frontend.
 */
export type RateLimitErrorData = {
	code: 'RATE_LIMITED';
	message: string;
	retryAfter: number;
};

/**
 * Create a rate limit ConvexError with consistent structure
 *
 * @param retryAfter - Time in milliseconds until the rate limit resets
 * @param message - User-friendly error message
 */
export function createRateLimitError(
	retryAfter: number,
	message: string
): ConvexError<RateLimitErrorData> {
	return new ConvexError({
		code: 'RATE_LIMITED' as const,
		message,
		retryAfter
	});
}
