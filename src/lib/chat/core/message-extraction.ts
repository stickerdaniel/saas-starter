import type { ChatMessage } from './types.js';

/**
 * Safely extract textual reasoning from a reasoning part.
 *
 * AI SDK part shapes can include reasoning entries without a textual payload yet.
 */
function getReasoningText(part: { type: string; text?: unknown }): string {
	if (part.type !== 'reasoning') return '';
	const text = part.text;
	return typeof text === 'string' ? text : '';
}

/**
 * Extract reasoning content from message parts
 */
export function extractReasoning(
	parts: Array<{ type: string; text?: unknown }> | undefined
): string {
	if (!parts) return '';
	return parts.map((part) => getReasoningText(part)).join('');
}

/**
 * Extract text content from user message (handles various formats)
 */
export function extractUserMessageText(msg: ChatMessage): string {
	// First try msg.text (UIMessage field)
	if (msg.text && typeof msg.text === 'string') {
		return msg.text;
	}

	// Then try msg.message.content
	if (msg.message?.content !== undefined && msg.message?.content !== null) {
		const content = msg.message.content;

		// String content (most common)
		if (typeof content === 'string') {
			return content;
		}

		// Array content (multimodal messages)
		if (Array.isArray(content)) {
			return content
				.map((part) => {
					if (typeof part === 'string') return part;
					if (part && typeof part === 'object' && 'text' in part) return part.text;
					return '';
				})
				.filter(Boolean)
				.join(' ');
		}

		// Object content with text field
		if (typeof content === 'object' && content !== null && 'text' in content) {
			return (content as { text: string }).text;
		}
	}

	return '';
}

/**
 * Normalize message to ensure top-level role exists
 */
export function normalizeMessage<T extends ChatMessage>(msg: T): T {
	return {
		...msg,
		role: msg.role || msg.message?.role || 'assistant'
	};
}
