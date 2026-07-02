/**
 * Shared Better Auth Convex JWT payload decoding for server hooks and loads.
 *
 * Decodes WITHOUT signature verification. The token comes from a cookie that
 * Better Auth already issued, and the values are only used for fast
 * first-paint decisions (admin role gate in hooks.server.ts, viewer fallback
 * in +layout.server.ts). Authoritative checks still happen in Convex
 * functions via authComponent.getAuthUser.
 */

/** Claims Better Auth puts into the Convex JWT that this app reads. */
export type ConvexJwtPayload = {
	sub: string;
	/** Expiry as unix seconds; used to derive the re-minted cookie lifetime. */
	exp?: number;
	name?: string;
	email?: string;
	image?: string | null;
	role?: string;
	emailVerified?: boolean;
	createdAt?: number;
	updatedAt?: number;
	banned?: boolean;
	locale?: string;
};

/**
 * Decode a JWT payload without verification (cookie is already trusted).
 *
 * Returns null for missing or malformed tokens and for payloads without a
 * `sub` claim, so callers never act on a token that does not identify a user.
 */
export function decodeJwtPayload(token: string | undefined): ConvexJwtPayload | null {
	if (!token) return null;
	try {
		const payload = token.split('.')[1];
		if (!payload) return null;
		const decoded = JSON.parse(
			Buffer.from(payload, 'base64url').toString('utf-8')
		) as Partial<ConvexJwtPayload> | null;
		if (!decoded?.sub) return null;
		return decoded as ConvexJwtPayload;
	} catch {
		return null;
	}
}
