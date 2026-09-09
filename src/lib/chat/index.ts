/**
 * Chat Library
 *
 * A reusable AI chat library built on top of Convex Agent.
 * Provides both headless core functionality and UI components.
 *
 * @example Executable text-only chat
 * Mount below a Convex client provider, an authentication provider such as `AppAuthProvider`, and
 * `TolgeeProvider`. The signed-in user must already own the supplied AI chat thread.
 * ```svelte
 * <script lang="ts">
 *   import SimpleChat from '$lib/chat/examples/SimpleChat.svelte';
 *   let { ownedThreadId }: { ownedThreadId: string } = $props();
 * </script>
 * <SimpleChat threadId={ownedThreadId} />
 * ```
 *
 * @example Using core without UI
 * ```typescript
 * import { ChatCore } from '$lib/chat/core';
 *
 * const core = new ChatCore({
 *   threadId: 'thread_123',
 *   api: { sendMessage: api.support.messages.sendMessage }
 * });
 *
 * // Access reactive state
 * core.isSending
 * core.error
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
	StreamStatus,
	SendMessageOptions,
	SendMessageResult,
	ChatConfig,
	CreateThreadOptions,
	CreateThreadResult,
	UploadResult,
	ProgressCallback,
	UploadErrorCode,
	ChatCoreAPI,
	ChatCoreOptions,
	ChatCoreErrorCode,
	ChatCommandErrorCode,
	ChatSessionPort,
	StreamCachePort
} from './core/index.js';

export {
	DEFAULT_CHAT_CONFIG,
	ALLOWED_FILE_EXT_MIME,
	ALLOWED_FILE_TYPES,
	ALLOWED_FILE_EXTENSIONS,
	MAX_FILE_SIZE,
	MAX_FILE_SIZE_LABEL,
	MAX_INPUT_IMAGE_SIZE,
	MAX_INPUT_IMAGE_SIZE_LABEL,
	extractReasoning,
	extractUserMessageText,
	normalizeMessage,
	deriveUIMessagesFromTextStreamParts,
	deriveUIMessagesFromDeltas,
	combineStreamingUIMessages,
	StreamCacheManager,
	uploadFileWithProgress,
	uploadToStorage,
	UploadError,
	ChatCore,
	createChatCore,
	ChatCommandError,
	ChatDraftManager,
	ChatAttachmentStore,
	clearPersistedChatState
} from './core/index.js';

// UI exports
export type {
	ChatInputProjection,
	ChatInputProjectionReason,
	ChatUIContextOptions,
	UploadConfig
} from './ui/index.js';

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
