/**
 * Whether a support conversation has actually been used.
 *
 * The overview hides conversations that were created but never carried a
 * message. Either denormalized trace of a message counts, because neither one
 * alone covers every stored conversation:
 *
 * - An admin may answer with an attachment and no words, which leaves the
 *   preview text empty while the timestamp is written. Requiring the text
 *   would hide exactly that conversation behind a launcher that keeps
 *   claiming an unread answer.
 * - Conversations stored before the timestamp was denormalized carry only the
 *   text until the backfill mutation is run by hand, which no upgrade does for
 *   the operator. Requiring the timestamp would take those away on upgrade.
 */
export function hasConversationActivity(thread: {
	lastMessage?: string;
	lastMessageAt?: number;
}): boolean {
	return thread.lastMessageAt !== undefined || Boolean(thread.lastMessage);
}
