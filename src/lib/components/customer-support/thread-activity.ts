/**
 * Whether a support conversation has actually been used.
 *
 * The overview hides conversations that were created but never carried a
 * message. Activity is decided on the timestamp rather than on the preview
 * text: an admin may answer with an attachment and no words, which leaves the
 * denormalized `lastMessage` empty while the conversation is real and, with an
 * unread reply, is the one the visitor is being pointed at. Deciding on the
 * text would hide exactly that conversation behind a launcher that keeps
 * claiming an unread answer.
 */
export function hasConversationActivity(thread: { lastMessageAt?: number }): boolean {
	return thread.lastMessageAt !== undefined;
}
