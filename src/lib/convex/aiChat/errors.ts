import { ConvexError } from 'convex/values';

export const AI_CHAT_ERROR_CODES = {
	threadNotFound: 'AI_CHAT_THREAD_NOT_FOUND',
	messageTooLong: 'AI_CHAT_MESSAGE_TOO_LONG'
} as const;

export type AiChatErrorCode = (typeof AI_CHAT_ERROR_CODES)[keyof typeof AI_CHAT_ERROR_CODES];

export function createAiChatError(
	code: AiChatErrorCode,
	data: Record<string, number | string> = {}
) {
	return new ConvexError({ code, ...data });
}
