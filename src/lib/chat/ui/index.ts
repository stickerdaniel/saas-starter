/**
 * Chat UI Components
 *
 * Svelte components for building AI chat interfaces.
 * Use these components with ChatRoot to get a full chat experience.
 */

// Context
export type { UploadConfig } from './ChatContext.svelte.js';

export {
	ChatUIContext,
	setChatUIContext,
	getChatUIContext,
	tryGetChatUIContext
} from './ChatContext.svelte.js';

// Types
/**
 * File metadata for dimension lookup
 * Map of fileId -> { width, height }
 */
export type FileMetadataMap = Record<string, { width?: number; height?: number }>;

// Components
export { default as ChatRoot } from './ChatRoot.svelte';
export { default as ChatMessages } from './ChatMessages.svelte';
export { default as ChatMessage } from './ChatMessage.svelte';
export { default as ChatReasoning } from './ChatReasoning.svelte';
export { default as ChatInput } from './ChatInput.svelte';
