/**
 * Utilities for handling anonymous user IDs in the support system.
 *
 * Anonymous users are identified by IDs with the format: anon_<UUID>
 * These are stored in localStorage on the client and used across the support system.
 */

/**
 * Prefix for anonymous user IDs
 */
export const ANONYMOUS_USER_PREFIX = 'anon_' as const;

/**
 * Type guard to check if a userId belongs to an anonymous user
 */
export const isAnonymousUser = (userId?: string | null): boolean =>
	userId?.startsWith(ANONYMOUS_USER_PREFIX) ?? false;

/**
 * Generate a new anonymous user ID
 * Only call this in browser context with crypto.randomUUID() available
 */
export const generateAnonymousUserId = (): string =>
	`${ANONYMOUS_USER_PREFIX}${crypto.randomUUID()}`;
