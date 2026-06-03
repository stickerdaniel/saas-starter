/**
 * A thread belongs in the sidebar once it has actually been used. Visibility keys
 * on lastMessageAt (written on every send, the same signal as first-send
 * detection), not on lastMessage, which is a display-only preview and is unset
 * for a file-only send. The lastMessage disjunct keeps any legacy row that has a
 * preview but no timestamp visible.
 *
 * Kept in its own import-light module so it can be unit-tested without pulling in
 * the Convex runtime graph (mirrors ownership.ts).
 */
export function isVisibleAiChatThread(r: {
	isWarm?: boolean;
	lastMessage?: string;
	lastMessageAt?: number;
}): boolean {
	return !r.isWarm && (r.lastMessageAt !== undefined || !!r.lastMessage);
}
