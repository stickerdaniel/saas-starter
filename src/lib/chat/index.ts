/**
 * Chat Library
 *
 * A reusable AI chat library built on top of Convex Agent.
 * Provides both headless core functionality and UI components.
 *
 * @example Executable text-only chat
 * Render this inside the existing Convex and authentication providers. The signed-in user must
 * already own the supplied thread.
 * ```svelte
 * <script lang="ts">
 *   import SimpleChat from '$lib/chat/examples/SimpleChat.svelte';
 *   import { api } from '$lib/convex/_generated/api';
 *   let { ownedThreadId }: { ownedThreadId: string } = $props();
 * </script>
 * <SimpleChat
 *   threadId={ownedThreadId}
 *   api={{
 *     sendMessage: api.aiChat.messages.sendMessage,
 *     listMessages: api.aiChat.messages.listMessages
 *   }}
 * />
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
	ChatCoreOptions
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
	ChatDraftManager,
	ChatAttachmentStore,
	clearPersistedChatState
} from './core/index.js';

// UI exports
export type { UploadConfig } from './ui/index.js';

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
