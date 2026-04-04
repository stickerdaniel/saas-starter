const SUPPORT_PREVIEW_LENGTH = 500;

export type SupportSearchFields = {
	title?: string;
	summary?: string;
	lastMessage?: string;
	userName?: string;
	userEmail?: string;
};

export type SupportLatestThreadMessage = {
	text?: string;
	_creationTime: number;
	agentName?: string;
	message?: {
		role?: 'user' | 'assistant' | 'tool' | 'system';
	};
};

/**
 * supportThreads is the feature registry for support access, search, and list rendering.
 * agent:messages provides the generic latest message, which we denormalize into supportThreads.
 */
export function buildSupportSearchText(fields: SupportSearchFields): string {
	return (
		[fields.title, fields.summary, fields.lastMessage, fields.userName, fields.userEmail]
			.filter(Boolean)
			.join(' | ')
			.toLowerCase() || 'untitled'
	);
}

export function buildSupportMessageDenormalization(args: {
	title?: string;
	summary?: string;
	userName?: string;
	userEmail?: string;
	latestMessage?: SupportLatestThreadMessage;
}) {
	const lastMessage = args.latestMessage?.text?.slice(0, SUPPORT_PREVIEW_LENGTH);

	return {
		lastMessage,
		lastMessageAt: args.latestMessage?._creationTime,
		lastMessageRole: args.latestMessage?.message?.role,
		lastAgentName: args.latestMessage?.agentName,
		searchText: buildSupportSearchText({
			title: args.title,
			summary: args.summary,
			lastMessage,
			userName: args.userName,
			userEmail: args.userEmail
		})
	};
}
