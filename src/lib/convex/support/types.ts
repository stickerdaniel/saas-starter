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
 * Type guard to check if an error is a rate limit error
 */
export function isRateLimitError(error: unknown): error is ConvexError<RateLimitErrorData> {
	if (!(error instanceof ConvexError)) return false;
	const data = error.data as { code?: string } | undefined;
	return data?.code === 'RATE_LIMITED';
}

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
