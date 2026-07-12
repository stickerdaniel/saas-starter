/**
 * Chat UI Components
 *
 * Svelte components for building AI chat interfaces.
 * Use these components with ChatRoot to get a full chat experience.
 */

// Context
export type { UploadConfig } from './chat-context.svelte.js';

export {
	ChatUIContext,
	setChatUIContext,
	getChatUIContext,
	tryGetChatUIContext
} from './chat-context.svelte.js';

// Types
/**
 * File metadata for dimension lookup
 * Map of URL -> { width, height }. Keyed by URL because UIMessage file parts
 * carry no fileId (see ChatMessages.defaultExtractAttachments).
 */
export type FileMetadataMap = Record<string, { width?: number; height?: number }>;

// Components
export { default as ChatRoot } from './ChatRoot.svelte';
export { default as ChatMessages } from './ChatMessages.svelte';
export { default as ChatMessage } from './ChatMessage.svelte';
export { default as ChatReasoning } from './ChatReasoning.svelte';
export { default as ChatInput } from './ChatInput.svelte';
