const MAX_PREVIEW_LABEL_LENGTH = 30;

/**
 * Sidebar label for an AI chat thread: prefer the LLM-generated title (the
 * rendering span CSS-truncates it), fall back to a truncated last-message
 * preview, then the localized empty-thread label. The empty-thread fallback is
 * reachable for a file-only thread that has no title or text preview yet.
 *
 * Import-light so it can be unit-tested without the $app/state dependency that
 * the surrounding sidebar config pulls in via localizedHref.
 */
export function aiChatThreadLabel(
	thread: { title?: string; lastMessage?: string },
	newConversationLabel?: string
): string {
	const title = thread.title?.trim();
	if (title) return title;

	const preview = thread.lastMessage;
	if (preview) {
		return preview.length > MAX_PREVIEW_LABEL_LENGTH
			? preview.slice(0, MAX_PREVIEW_LABEL_LENGTH) + '...'
			: preview;
	}

	return newConversationLabel || 'New conversation';
}
