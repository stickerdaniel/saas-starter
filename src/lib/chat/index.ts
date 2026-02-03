/**
 * Chat Library
 *
 * A reusable AI chat library built on top of Convex Agent.
 * Provides both headless core functionality and UI components.
 *
 * @example Basic usage with UI components
 * ```svelte
 * <script>
 *   import { ChatRoot, ChatMessages, ChatInput } from '$lib/chat';
 *   import { api } from '$lib/convex/_generated/api';
 * </script>
 *
 * <ChatRoot
 *   threadId="thread_123"
 *   api={{
 *     sendMessage: api.support.messages.sendMessage,
 *     listMessages: api.support.messages.listMessages
 *   }}
 * >
 *   <ChatMessages />
 *   <ChatInput />
 * </ChatRoot>
 * ```
 *
 * @example Using core without UI
 * ```typescript
 * import { ChatCore, createChatCore } from '$lib/chat/core';
 *
 * const core = createChatCore({
 *   threadId: 'thread_123',
 *   api: { sendMessage: api.support.messages.sendMessage }
 * });
 *
 * // Access reactive state
 * core.messages
 * core.isStreaming
 * core.sendMessage(client, 'Hello!')
 * ```
 */

// Core exports
export type {
	UploadState,
	Attachment,
	MessageStatus,
	MessageRole,
	ChatMessage,
	DisplayMessage,
	TextUIPart,
	ReasoningUIPart,
	MessagePart,
	PaginationState,
	StreamStatus,
	SendMessageOptions,
	SendMessageResult,
	ChatConfig,
	CreateThreadOptions,
	CreateThreadResult,
	UploadResult,
	ProgressCallback,
	ChatCoreAPI,
	ChatCoreOptions
} from './core/index.js';

export {
	DEFAULT_CHAT_CONFIG,
	ALLOWED_FILE_TYPES,
	ALLOWED_FILE_EXTENSIONS,
	MAX_FILE_SIZE,
	MAX_FILE_SIZE_LABEL,
	extractReasoning,
	extractUserMessageText,
	normalizeMessage,
	deriveUIMessagesFromTextStreamParts,
	StreamCacheManager,
	uploadFileWithProgress,
	createUploadState,
	createSuccessState,
	createErrorState,
	updateProgress,
	FileUploadManager,
	ChatCore,
	createChatCore
} from './core/index.js';

// UI exports
export type { UploadConfig, FileMetadataMap } from './ui/index.js';

export {
	ChatUIContext,
	setChatUIContext,
	getChatUIContext,
	tryGetChatUIContext
} from './ui/index.js';

// UI Components
export { default as ChatRoot } from './ui/ChatRoot.svelte';
export { default as ChatMessages } from './ui/ChatMessages.svelte';
export { default as ChatMessageComponent } from './ui/ChatMessage.svelte';
export { default as ChatReasoning } from './ui/ChatReasoning.svelte';
export { default as ChatInput } from './ui/ChatInput.svelte';
export { default as ChatAttachments } from './ui/ChatAttachments.svelte';
